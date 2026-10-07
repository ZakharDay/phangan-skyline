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

  // Sky along a ray that never hits anything, without the lamps' own glow
  vec3 skyBase(vec3 ro, vec3 rd) {
    float up = max(rd.y, 0.0);
    vec3 background = uSkyZenith * (0.6 + 0.4 * pow(1.0 - up, 3.0));
    float T = exp(-opticalDepth(ro, rd, 2e5));
    return background * T + uSkyGlow * (1.0 - T);
  }

  vec3 skyRadiance(vec3 ro, vec3 rd) {
    return skyBase(ro, rd) + lampScatter(ro, rd, 2e5);
  }

  // Dims a surface at distance t and adds the air glowing in front of it
  vec3 applyAtmosphere(vec3 color, vec3 ro, vec3 rd, float t) {
    float T = exp(-opticalDepth(ro, rd, t));
    return color * T + uSkyGlow * (1.0 - T) + lampScatter(ro, rd, t);
  }
`

export { createAtmosphere, atmosphereGLSL, MAX_FOG_LIGHTS }
