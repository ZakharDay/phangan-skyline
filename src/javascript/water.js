import * as THREE from 'three'
import { SWELL, RIPPLES } from './waves.js'
import { atmosphereGLSL } from './atmosphere.js'

const MAX_REFLECTED_LIGHTS = 96

const vertexShader = /* glsl */ `
  #define NS ${SWELL.length}

  uniform float uTime;
  uniform vec4 uSwell[NS];
  uniform float uSwellGain;

  varying vec3 vWorld;
  varying vec3 vBase;

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vBase = p;

    #ifdef DISPLACE
      // Gerstner swell, faded out with distance so the mesh edge blends into the flat far plane
      float fade = 1.0 - smoothstep(250.0, 520.0, length(p.xz - cameraPosition.xz));
      vec3 d = vec3(0.0);
      for (int i = 0; i < NS; i++) {
        vec4 w = uSwell[i];
        float a = w.z * uSwellGain;
        float k = 6.2831853 / w.w;
        float c = sqrt(9.81 / k);
        float f = k * (dot(w.xy, p.xz) - c * uTime) + float(i) * 1.37;
        d.xz += 0.35 * a * w.xy * cos(f);
        d.y += a * sin(f);
      }
      p += d * fade;
      vWorld = p;
    #else
      // the far plane sits a little lower only for depth sorting; it is shaded at sea level
      // so reflections line up across the seam with the near mesh
      vWorld = vec3(p.x, 0.0, p.z);
    #endif

    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  #define NS ${SWELL.length}
  #define NR ${RIPPLES.length}
  #define NL ${MAX_REFLECTED_LIGHTS}

  ${atmosphereGLSL}

  uniform float uTime;
  uniform vec4 uSwell[NS];
  uniform vec4 uRipple[NR];
  uniform float uSwellGain;
  uniform float uRippleGain;
  uniform vec3 uWaterColor;
  uniform vec3 uLightPos[NL];
  uniform vec3 uLightColor[NL];
  // xy: horizontal direction from the camera to the light, z: horizontal distance to it
  uniform vec3 uLightDir[NL];
  uniform int uLightCount;

  varying vec3 vWorld;
  varying vec3 vBase;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Adds the slope of one sine wave; waves smaller than the pixel footprint
  // are faded out and their slope variance (per axis) moves into the roughness
  void addWave(vec4 w, float phase, float gain, vec2 p, float footprint, inout vec2 slope, inout vec2 lostVar) {
    float k = 6.2831853 / w.w;
    float c = sqrt(9.81 / k);
    float f = k * (dot(w.xy, p) - c * uTime) + phase;
    float s = w.z * gain * k;
    float visible = 1.0 - smoothstep(0.08, 0.5, footprint / w.w);
    slope += w.xy * (s * cos(f) * visible);
    lostVar += (1.0 - visible) * s * s * 0.5 * w.xy * w.xy;
  }

  // Anisotropic Beckmann distribution of the sub-pixel facets around the resolved slope.
  // The ripples run mostly toward the shore, so light paths stretch toward the camera
  // into long narrow columns.
  float facets(vec3 H, vec2 slope, vec2 m2) {
    float hy = max(H.y, 1e-3);
    vec2 s = -H.xz / hy - slope;
    float hy2 = hy * hy;
    return exp(-(s.x * s.x / m2.x + s.y * s.y / m2.y)) / (3.14159265 * sqrt(m2.x * m2.y) * hy2 * hy2);
  }

  void main() {
    vec2 p = vBase.xz;
    float footprint = max(length(dFdx(p)), length(dFdy(p)));

    vec2 slope = vec2(0.0);
    vec2 lostVar = vec2(0.0);

    for (int i = 0; i < NS; i++) {
      addWave(uSwell[i], float(i) * 1.37, uSwellGain, p, footprint, slope, lostVar);
    }

    // Slowly drifting patches of slightly stronger breeze ("cat's paws")
    float breeze = vnoise(p * 0.018 + vec2(uTime * 0.02, uTime * 0.035));
    breeze = mix(0.45, 1.35, smoothstep(0.2, 0.8, breeze)) * uRippleGain;
    for (int i = 0; i < NR; i++) {
      addWave(uRipple[i], float(i) * 2.399, breeze, p, footprint, slope, lostVar);
    }

    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 V = toEye / dist;

    float NdV = max(dot(N, V), 1e-3);
    vec2 m2 = vec2(0.001) + 2.0 * lostVar;

    // Reflected sky. Two samples tilted by the unresolved ripples, so far away the water
    // doesn't turn into a mirror of the bright band right above the horizon.
    vec3 color = vec3(0.0);
    float tilt = sqrt(m2.y) * 0.7;
    for (int k = 0; k < 2; k++) {
      vec3 Nk = normalize(vec3(-slope.x, 1.0, -slope.y + (k == 0 ? tilt : -tilt)));
      float NkV = max(dot(Nk, V), 1e-3);
      float fresnel = 0.02 + 0.98 * pow(1.0 - NkV, 5.0);
      vec3 R = reflect(-V, Nk);
      R.y = abs(R.y);
      color += 0.5 * mix(uWaterColor, skyBase(vWorld, R), fresnel);
    }

    // Moon glitter path
    {
      vec3 H = normalize(uMoonDir + V);
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      color += uMoonLight * 0.1 * facets(H, slope, m2) * F / (4.0 * NdV) * step(0.0, dot(N, uMoonDir));
    }

    // Boat lamps: a broken column of light per lamp, and a faint glow in the water around the boat.
    // First the facet tilt this point would need to bounce the lamp into the camera; if the
    // ripples practically never tilt that far (and the point is outside the boat's own glow),
    // the lamp is skipped before the expensive part. Only invisible light is dropped, so
    // no edges appear however wide the columns spread.
    // A cheap geometric bound goes first: how far to the side of the camera-lamp line the light
    // can land depends on how far this point is from the camera (dc) and from the lamp (rL).
    // Near the camera a column can fan out wide, in the middle distance it is always narrow.
    // The bound assumes sideways ripple tilts up to 0.35: the ripples run toward the shore,
    // so even in the strongest breeze here sideways tilts average about 0.08.
    float facetNorm = 1.0 / (3.14159265 * sqrt(m2.x * m2.y));
    vec2 toPoint = vWorld.xz - cameraPosition.xz;
    float dc = max(length(toPoint), 1.0);
    vec2 viewDir = toPoint / dc;
    for (int i = 0; i < NL; i++) {
      if (i >= uLightCount) break;
      vec3 Lv = uLightPos[i] - vWorld;
      float r2 = dot(Lv, Lv);
      vec3 ld = uLightDir[i];
      float rL = max(abs(ld.z - dc), 10.0);
      float maxSide = 0.35 * (cameraPosition.y / dc + 6.0 / rL) / (1.0 + dc / rL);
      if (r2 > 40000.0 && abs(viewDir.x * ld.y - viewDir.y * ld.x) > maxSide) continue;
      float invR = inversesqrt(r2);
      vec3 L = Lv * invR;
      vec3 H = normalize(L + V);
      float hy = max(H.y, 1e-3);
      vec2 s = -H.xz / hy - slope;
      float tiltCost = s.x * s.x / m2.x + s.y * s.y / m2.y;
      bool inGlow = r2 < 40000.0;
      if (tiltCost > 16.0 && !inGlow) continue;

      float hy2 = hy * hy;
      float D = exp(-tiltCost) * facetNorm / (hy2 * hy2);
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float NdL = dot(N, L);
      vec3 E = uLightColor[i] / r2;
      float pool = inGlow ? 0.004 * max(NdL, 0.0) * (1.0 - smoothstep(60.0, 200.0, r2 * invR)) : 0.0;
      color += E * (D * F / (4.0 * NdV) * step(0.0, NdL) + pool);
    }

    color = applyAtmosphere(color, cameraPosition, -V, dist);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function createWater(atmosphere) {
  const lightPos = []
  const lightColor = []
  const lightDir = []
  for (let i = 0; i < MAX_REFLECTED_LIGHTS; i++) {
    lightPos.push(new THREE.Vector3())
    lightColor.push(new THREE.Vector3())
    lightDir.push(new THREE.Vector3())
  }

  const uniforms = {
    ...atmosphere,
    uTime: { value: 0 },
    uSwell: { value: SWELL },
    uRipple: { value: RIPPLES },
    uSwellGain: { value: 1 },
    uRippleGain: { value: 1 },
    uWaterColor: { value: new THREE.Color() },
    uLightPos: { value: lightPos },
    uLightColor: { value: lightColor },
    uLightDir: { value: lightDir },
    uLightCount: { value: 0 }
  }

  // Dense, displaced mesh near the shore, drawn first so it hides the far plane under it
  const nearGeometry = new THREE.PlaneGeometry(1400, 1400, 700, 700)
  nearGeometry.rotateX(-Math.PI / 2)
  const near = new THREE.Mesh(
    nearGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      defines: { DISPLACE: 1 }
    })
  )
  near.position.z = -600
  near.renderOrder = 0
  near.frustumCulled = false

  // Flat plane out to the horizon, slightly lower so the swell troughs never dip under it
  const farGeometry = new THREE.PlaneGeometry(200000, 200000, 1, 1)
  farGeometry.rotateX(-Math.PI / 2)
  const far = new THREE.Mesh(
    farGeometry,
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
  )
  far.position.y = -1
  far.renderOrder = 1

  return { meshes: [near, far], uniforms, lightPos, lightColor, lightDir }
}

export { createWater, MAX_REFLECTED_LIGHTS }
