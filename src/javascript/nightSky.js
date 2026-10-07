import * as THREE from 'three'

// Procedural night sky: gradient, stars, Milky Way and the moon with its halo.
// Values are linear HDR, meant to go through ACES tone mapping like the day Sky.

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // always at camera.far
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 moonPosition;
  uniform float time;

  varying vec3 vWorldPosition;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
      u.z
    );
  }

  float fbm(vec3 p) {
    float r = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      r += a * noise3(p);
      p *= 2.03;
      a *= 0.5;
    }
    return r;
  }

  // One layer of stars: one candidate per 3D cell around the unit sphere.
  // Star size never drops below the pixel footprint, so they don't flicker from aliasing.
  vec3 starLayer(vec3 dir, float scale, float density, float footprint) {
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 h = hash33(cell);
    if (h.x > density) return vec3(0.0);

    vec3 starDir = normalize(cell + 0.25 + 0.5 * hash33(cell + 17.0));
    float d = length(dir - starDir);

    float radius = 0.0006;
    float size = max(radius, footprint * 0.7);
    float energy = (radius * radius) / (size * size);

    // Most stars are faint, a few are bright
    float mag = pow(h.y, 8.0) * 25.0 + 0.15;
    float twinkle = 0.75 + 0.25 * sin(time * (1.5 + h.z * 3.0) + h.y * 40.0);

    // Color temperature from reddish to bluish
    vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.7, 0.82, 1.0), h.z);

    return tint * mag * twinkle * energy * exp(-d * d / (size * size));
  }

  void main() {
    vec3 dir = normalize(vWorldPosition - cameraPosition);
    vec3 moon = normalize(moonPosition);
    float up = max(dir.y, 0.0);
    float footprint = length(fwidth(dir));

    // Base gradient: a little brighter and bluer toward the horizon
    vec3 zenith = vec3(0.0012, 0.0022, 0.0055);
    vec3 horizon = vec3(0.006, 0.010, 0.020);
    vec3 col = mix(horizon, zenith, pow(up, 0.45));

    // Moonlight scattered in the atmosphere
    float cosMoon = dot(dir, moon);
    col += vec3(0.05, 0.075, 0.12) * pow(max(cosMoon, 0.0), 6.0) * 0.25;
    col += vec3(0.25, 0.30, 0.38) * pow(max(cosMoon, 0.0), 120.0) * 0.4;
    col += vec3(0.6, 0.65, 0.7) * pow(max(cosMoon, 0.0), 2500.0) * 0.6;

    // Atmospheric extinction near the horizon
    float extinction = smoothstep(0.0, 0.18, up);

    // Milky Way: a soft band along a tilted great circle
    vec3 galaxyNormal = normalize(vec3(1.0, 0.5, 0.3));
    float band = exp(-pow(dot(dir, galaxyNormal) / 0.22, 2.0));
    float clouds = fbm(dir * 6.0);
    float dust = smoothstep(0.45, 0.75, fbm(dir * 14.0 + 3.0));
    float milky = band * smoothstep(0.3, 0.8, clouds) * (1.0 - 0.7 * dust);
    col += vec3(0.030, 0.032, 0.042) * milky * extinction;

    // Stars, denser inside the Milky Way
    vec3 stars = starLayer(dir, 140.0, 0.035, footprint)
      + starLayer(dir, 260.0, 0.006 + band * 0.03 * milky, footprint) * 0.6
      + starLayer(dir, 480.0, 0.002 + band * 0.05 * milky, footprint) * 0.4;
    // the moon washes out stars around it
    stars *= 1.0 - 0.85 * pow(max(cosMoon, 0.0), 30.0);
    col += stars * extinction * 0.35;

    // Moon disc with faint maria
    float moonRadius = 0.0105; // a bit larger than real for a nicer look
    float dm = length(dir - moon);
    float disc = 1.0 - smoothstep(moonRadius - max(footprint, 0.0004), moonRadius, dm);
    if (disc > 0.0) {
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), moon));
      vec3 north = cross(moon, east);
      vec2 uv = vec2(dot(dir - moon, east), dot(dir - moon, north)) / moonRadius;
      float maria = smoothstep(0.45, 0.7, fbm(vec3(uv * 2.2, 1.7)));
      float limb = sqrt(max(1.0 - dot(uv, uv), 0.0));
      vec3 moonCol = vec3(1.0, 0.97, 0.9) * (1.0 - 0.35 * maria) * (0.75 + 0.25 * limb);
      col = mix(col, moonCol * 9.0, disc);
    }

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

class NightSky extends THREE.Mesh {
  constructor() {
    super(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: {
          moonPosition: { value: new THREE.Vector3(0, 0.2, -1) },
          time: { value: 0 }
        },
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false
      })
    )
  }
}

export { NightSky }
