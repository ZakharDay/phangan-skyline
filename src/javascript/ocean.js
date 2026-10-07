import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

// Sun position: low over the sea, slightly to the right of the view direction
const SUN_ELEVATION = 7 // degrees
const SUN_AZIMUTH = 168 // degrees, 180 = straight ahead (-z)

// Waves travel from the horizon toward the shore (+z)
const WIND_ANGLE = 0.15

// Seeded RNG so the sea looks the same on every reload
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function wave(angle, amplitude, wavelength) {
  const a = WIND_ANGLE + angle
  return new THREE.Vector4(Math.sin(a), Math.cos(a), amplitude, wavelength)
}

// Long, low swell — moves the geometry
const SWELL = [
  wave(0.0, 0.11, 42),
  wave(0.35, 0.06, 23),
  wave(-0.45, 0.045, 14),
  wave(0.8, 0.025, 8.5)
]

// Short ripples — only perturb the normals in the fragment shader
function makeRipples(count) {
  const rand = mulberry32(7)
  const ripples = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const wavelength = 5.0 * Math.pow(0.12 / 5.0, t) * (0.85 + rand() * 0.3)
    const steepness = 0.0055 * (0.7 + rand() * 0.6)
    const angle = (rand() * 2 - 1) * 1.2
    ripples.push(wave(angle, wavelength * steepness, wavelength))
  }
  return ripples
}

const RIPPLES = makeRipples(24)

const waterVertex = /* glsl */ `
  #define NS ${SWELL.length}

  uniform float uTime;
  uniform vec4 uSwell[NS];

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
        float k = 6.2831853 / w.w;
        float c = sqrt(9.81 / k);
        float f = k * (dot(w.xy, p.xz) - c * uTime) + float(i) * 1.37;
        float q = 0.35;
        d.xz += q * w.z * w.xy * cos(f);
        d.y += w.z * sin(f);
      }
      p += d * fade;
    #endif

    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

const waterFragment = /* glsl */ `
  #define NS ${SWELL.length}
  #define NR ${RIPPLES.length}

  uniform float uTime;
  uniform vec4 uSwell[NS];
  uniform vec4 uRipple[NR];
  uniform samplerCube uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;

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
  // are faded out and their slope variance is moved into the roughness instead
  void addWave(vec4 w, float phase, float gain, vec2 p, float footprint, inout vec2 slope, inout float lostVar) {
    float k = 6.2831853 / w.w;
    float c = sqrt(9.81 / k);
    float f = k * (dot(w.xy, p) - c * uTime) + phase;
    float s = w.z * gain * k;
    float visible = 1.0 - smoothstep(0.08, 0.5, footprint / w.w);
    slope += w.xy * (s * cos(f) * visible);
    lostVar += (1.0 - visible) * s * s * 0.5;
  }

  void main() {
    vec2 p = vBase.xz;
    float footprint = max(length(dFdx(p)), length(dFdy(p)));

    vec2 slope = vec2(0.0);
    float lostVar = 0.0;

    for (int i = 0; i < NS; i++) {
      addWave(uSwell[i], float(i) * 1.37, 1.0, p, footprint, slope, lostVar);
    }

    // Slowly drifting patches of slightly stronger breeze ("cat's paws")
    float breeze = vnoise(p * 0.018 + vec2(uTime * 0.02, uTime * 0.035));
    breeze = mix(0.45, 1.35, smoothstep(0.2, 0.8, breeze));
    for (int i = 0; i < NR; i++) {
      addWave(uRipple[i], float(i) * 2.399, breeze, p, footprint, slope, lostVar);
    }

    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);

    float NdV = max(dot(N, V), 1e-3);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

    // Sky reflection; flip rays that would point under the surface
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = textureCube(uSky, R).rgb;

    // Light scattered up from inside the water
    vec3 skyUp = textureCube(uSky, vec3(0.0, 1.0, 0.0)).rgb;
    float sunUp = max(L.y, 0.0);
    vec3 body = vec3(0.012, 0.05, 0.065) * (skyUp * 1.5 + uSunColor * sunUp * 0.02);
    // a touch of turquoise where the light passes through the backs of the swell
    float thru = pow(max(dot(-V, L), 0.0), 4.0) * clamp(slope.y * 6.0 + 0.3, 0.0, 1.0);
    body += vec3(0.02, 0.09, 0.08) * uSunColor * 0.01 * thru;

    // Sun glitter: Beckmann lobe whose width grows with the sub-pixel ripples
    vec3 H = normalize(L + V);
    float NdH = max(dot(N, H), 1e-3);
    float m2 = 0.0025 + lostVar;
    float NdH2 = NdH * NdH;
    float D = exp((NdH2 - 1.0) / (m2 * NdH2)) / (3.14159265 * m2 * NdH2 * NdH2);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 spec = uSunColor * D * Fs / (4.0 * NdV) * step(0.0, dot(N, L));

    vec3 color = mix(body, sky, fresnel) + spec;

    // Haze toward the horizon, matching the sky right above it
    float dist = length(vWorld - cameraPosition);
    vec3 horizon = textureCube(uSky, normalize(vec3(-V.x, 0.002, -V.z))).rgb;
    color = mix(color, horizon, smoothstep(2500.0, 60000.0, dist) * 0.6);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function initOcean() {
  const container = document.querySelector('.sketchContainer')

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.3
  renderer.autoClear = false
  container.appendChild(renderer.domElement)

  // Eye height of a person standing on the beach
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1e6)
  camera.position.set(0, 1.8, 0)
  camera.lookAt(0, 1.0, -100)

  // Sky
  const skyScene = new THREE.Scene()
  const sky = new Sky()
  sky.scale.setScalar(450000)
  skyScene.add(sky)

  const sun = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
    THREE.MathUtils.degToRad(SUN_AZIMUTH)
  )
  const skyUniforms = sky.material.uniforms
  skyUniforms.turbidity.value = 2.5
  skyUniforms.rayleigh.value = 1.6
  skyUniforms.mieCoefficient.value = 0.003
  skyUniforms.mieDirectionalG.value = 0.85
  skyUniforms.cloudCoverage.value = 0.25
  skyUniforms.cloudDensity.value = 0.35
  skyUniforms.sunPosition.value.copy(sun)

  // Sky is rendered into a cube map that the water reflects
  const cubeTarget = new THREE.WebGLCubeRenderTarget(256, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter
  })
  const cubeCamera = new THREE.CubeCamera(1, 1e6, cubeTarget)
  skyScene.add(cubeCamera)

  // Water
  const waterScene = new THREE.Scene()
  const uniforms = {
    uTime: { value: 0 },
    uSwell: { value: SWELL },
    uRipple: { value: RIPPLES },
    uSky: { value: cubeTarget.texture },
    uSunDir: { value: sun },
    uSunColor: { value: new THREE.Color(1.0, 0.78, 0.52).multiplyScalar(18) }
  }

  // Dense, displaced mesh near the shore
  const nearGeometry = new THREE.PlaneGeometry(1200, 1200, 600, 600)
  nearGeometry.rotateX(-Math.PI / 2)
  const near = new THREE.Mesh(
    nearGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      defines: { DISPLACE: 1 }
    })
  )
  near.position.z = -500
  near.renderOrder = 1

  // Flat plane out to the horizon, drawn first and overdrawn by the near mesh
  const farGeometry = new THREE.PlaneGeometry(200000, 200000, 1, 1)
  farGeometry.rotateX(-Math.PI / 2)
  const far = new THREE.Mesh(
    farGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      depthWrite: false
    })
  )
  far.renderOrder = 0

  waterScene.add(far, near)

  function resize() {
    const { width, height } = container.getBoundingClientRect()
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime()
    uniforms.uTime.value = t
    skyUniforms.time.value = t

    // Clouds drift, so refresh the reflection every frame (cheap at 256px)
    cubeCamera.update(renderer, skyScene)

    renderer.clear()
    renderer.render(skyScene, camera)
    renderer.render(waterScene, camera)
  })
}

export { initOcean }
