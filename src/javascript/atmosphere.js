import * as THREE from 'three'

// Humid air over the sea, lit by the boats' lamps.
//
// Two exponential height layers: a broad haze, and a thin mist hugging the water.
// Light reaching the eye along a ray = what's behind it, dimmed by the air,
// plus light scattered into the ray:
//   - an ambient skyglow (all the distant lamps together),
//   - single scattering from each nearby boat, integrated analytically.
// Every shader in the scene includes this chunk so they all agree.

const MAX_FOG_LIGHTS = 16

function createAtmosphere() {
  const fogLightPos = []
  const fogLightColor = []
  for (let i = 0; i < MAX_FOG_LIGHTS; i++) {
    fogLightPos.push(new THREE.Vector3())
    fogLightColor.push(new THREE.Vector3())
  }

  return {
    uHazeDensity: { value: 1e-4 },
    uHazeHeight: { value: 800 },
    uMistDensity: { value: 0 },
    uMistHeight: { value: 12 },
    uSkyZenith: { value: new THREE.Color() },
    uSkyGlow: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonSunDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonDisc: { value: new THREE.Color() },
    uMoonLight: { value: new THREE.Color() },
    uFogLightPos: { value: fogLightPos },
    uFogLightColor: { value: fogLightColor },
    uFogLightCount: { value: 0 }
  }
}

const atmosphereGLSL = /* glsl */ `
  #define NFOG ${MAX_FOG_LIGHTS}

  uniform float uHazeDensity;
  uniform float uHazeHeight;
  uniform float uMistDensity;
  uniform float uMistHeight;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyGlow;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonSunDir;
  uniform vec3 uMoonDisc; // brightness of the lit part of the disc
  uniform vec3 uMoonLight; // moonlight reaching the scene: lit fraction, faded near the horizon
  uniform vec3 uFogLightPos[NFOG];
  uniform vec3 uFogLightColor[NFOG];
  uniform int uFogLightCount;

  float layerDepth(float density, float height, vec3 ro, vec3 rd, float t) {
    float a = density * exp(-max(ro.y, 0.0) / height);
    float k = rd.y / height;
    if (abs(k * t) < 1e-3) return a * t;
    return a * (1.0 - exp(min(-k * t, 60.0))) / k;
  }

  // Optical depth along ro + rd * [0, t]
  float opticalDepth(vec3 ro, vec3 rd, float t) {
    return layerDepth(uHazeDensity, uHazeHeight, ro, rd, t)
      + layerDepth(uMistDensity, uMistHeight, ro, rd, t);
  }

  float densityAt(float y) {
    y = max(y, 0.0);
    return uHazeDensity * exp(-y / uHazeHeight) + uMistDensity * exp(-y / uMistHeight);
  }

  // Light scattered toward the eye by the boats' lamps along ro + rd * [0, tMax].
  // Per light: closed-form integral of 1 / distance^2 along the ray, with the
  // density taken where the ray passes closest to the lamp.
  vec3 lampScatter(vec3 ro, vec3 rd, float tMax) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < NFOG; i++) {
      if (i >= uFogLightCount) break;
      vec3 rel = uFogLightPos[i] - ro;
      float t0 = dot(rel, rd);
      vec3 perp = rel - rd * t0;
      float h = sqrt(max(dot(perp, perp), 1.0));
      float ang = atan((tMax - t0) / h) - atan(-t0 / h);
      float tc = clamp(t0, 0.0, tMax);
      float dens = densityAt(ro.y + rd.y * tc);
      float trans = exp(-opticalDepth(ro, rd, tc) - dens * h);
      sum += uFogLightColor[i] * (dens * trans * ang / h);
    }
    return sum * 0.0795775; // 1 / (4 pi), isotropic
  }

  // Moonlight scattered around the disc: a bright close aureole, a softer ring,
  // and a wide glow that grows with the humidity
  vec3 moonGlow(vec3 rd) {
    float a = length(rd - uMoonDir); // angle from the moon, radians
    float haze = uHazeDensity * 1e4;
    return uMoonLight * (
      0.6 * exp(-a / 0.006) +
      0.08 * exp(-a / 0.05) +
      (0.002 + 0.004 * haze) * exp(-a / 0.25)
    );
  }

  // The disc itself, lit from the sun's side so the phase faces the right way
  vec3 moonDisc(vec3 rd) {
    const float radius = 0.0075;
    vec3 d = rd - uMoonDir;
    if (dot(d, d) > radius * radius * 1.5) return vec3(0.0);
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 up = cross(uMoonDir, side);
    vec2 uv = vec2(dot(d, side), dot(d, up)) / radius;
    float r = length(uv);
    vec3 n = side * uv.x + up * uv.y - uMoonDir * sqrt(max(1.0 - r * r, 0.0));
    float lit = max(dot(n, uMoonSunDir), 0.0) + 0.012; // a little earthshine on the dark part
    return uMoonDisc * lit * smoothstep(1.0, 0.8, r);
  }

  // Sky along a ray that never hits anything, without the lamps' own glow
  vec3 skyBase(vec3 ro, vec3 rd) {
    float up = max(rd.y, 0.0);
    vec3 background = uSkyZenith * (0.6 + 0.4 * pow(1.0 - up, 3.0));
    float T = exp(-opticalDepth(ro, rd, 2e5));
    return background * T + uSkyGlow * (1.0 - T) + moonGlow(rd);
  }

  vec3 skyRadiance(vec3 ro, vec3 rd) {
    // haze dims blue more than red, so a low moon turns orange
    vec3 T = exp(-opticalDepth(ro, rd, 2e5) * vec3(0.6, 1.0, 1.6));
    return skyBase(ro, rd) + moonDisc(rd) * T + lampScatter(ro, rd, 2e5);
  }

  // Dims a surface at distance t and adds the air glowing in front of it
  vec3 applyAtmosphere(vec3 color, vec3 ro, vec3 rd, float t) {
    float T = exp(-opticalDepth(ro, rd, t));
    return color * T + uSkyGlow * (1.0 - T) + lampScatter(ro, rd, t);
  }
`

export { createAtmosphere, atmosphereGLSL, MAX_FOG_LIGHTS }
