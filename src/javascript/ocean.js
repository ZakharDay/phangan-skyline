import * as THREE from 'three'
import { createAtmosphere } from './atmosphere.js'
import { createSky } from './sky.js'
import { createWater } from './water.js'
import { createBoats } from './boats.js'
import { DEFAULTS, createControls } from './controls.js'
import { generateNight } from './night.js'
import { randomHash, hashFromUrl } from './random.js'

const MOON_COLOR = new THREE.Color(0.9, 0.95, 1.0)
// how much a bright moon lifts the night sky and the glow over the horizon
const MOON_SKY = new THREE.Color(0.004, 0.011, 0.024)
const MOON_HAZE = new THREE.Color(0.005, 0.013, 0.02)

// Night sea off Koh Phangan seen from a hillside: squid boats' lamps on the water,
// humid air glowing with their light.

// Tone mapping: untouched in the dark range so the night colors match the photos,
// then a soft shoulder that turns the bright lamps white (Khronos Neutral without its toe,
// which would wipe out the red channel of the dark teal tones)
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  /* glsl */ `
  vec3 CustomToneMapping( vec3 color ) {
    color *= toneMappingExposure;
    const float start = 0.6;
    float peak = max( color.r, max( color.g, color.b ) );
    if ( peak <= start ) return color;
    float d = 1.0 - start;
    float newPeak = 1.0 - d * d / ( peak + d - start );
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / ( 0.15 * ( peak - newPeak ) + 1.0 );
    return mix( color, vec3( newPeak ), g );
  }`
)

function initOcean() {
  const container = document.querySelector('.sketchContainer')

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.toneMapping = THREE.CustomToneMapping
  container.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(54, 1, 1, 1e6)
  const scene = new THREE.Scene()

  const atmosphere = createAtmosphere()
  scene.add(createSky(atmosphere))
  const water = createWater(atmosphere)
  scene.add(...water.meshes)
  const boats = createBoats(atmosphere, water)
  scene.add(boats.object)

  const settings = { ...DEFAULTS }
  const color = (target, hex, level) => target.set(hex).multiplyScalar(level)

  // The night comes from the hash in the address (?h=0x...), or a fresh random one
  const params = new URLSearchParams(location.search)
  let night = null
  let hash = hashFromUrl() ?? randomHash()
  let source = params.get('src') === 'token' ? 'token' : 'date'

  function resize() {
    const { width, height } = container.getBoundingClientRect()
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    // The camera stays level and the frame is shifted instead of tilting the camera, like a
    // shift lens: verticals stay vertical, so the lamp columns on the water run straight down
    // even at the edges of the view. "Pitch" says how far down the shifted frame looks.
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    camera.projectionMatrix.elements[9] = Math.tan(THREE.MathUtils.degToRad(settings.pitch)) / Math.tan(halfFov)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    boats.resize(camera, height, renderer.getPixelRatio())
  }

  function apply() {
    const s = settings

    atmosphere.uHazeDensity.value = 2e-5 * Math.pow(150, s.humidity)
    atmosphere.uHazeHeight.value = s.hazeHeight
    atmosphere.uMistDensity.value = s.mist * 0.02
    atmosphere.uMistHeight.value = s.mistHeight
    color(atmosphere.uSkyZenith.value, s.skyZenith, s.skyZenithLevel)
    color(atmosphere.uSkyGlow.value, s.skyGlow, s.skyGlowLevel)

    // A bright moon high up lifts the whole night sky
    const moon = night.moon
    const skyLift = moon.light * s.moonGain
    atmosphere.uSkyZenith.value.add(MOON_SKY.clone().multiplyScalar(skyLift))
    atmosphere.uSkyGlow.value.add(MOON_HAZE.clone().multiplyScalar(skyLift))
    atmosphere.uMoonDir.value.copy(moon.direction)
    atmosphere.uMoonSunDir.value.copy(moon.sunDirection)
    atmosphere.uMoonDisc.value.copy(MOON_COLOR).multiplyScalar(moon.altitude > -0.01 ? 6 * s.moonGain : 0)

    // Moonlight on the water passes through the haze along the moon's line of sight:
    // dimmer and redder near the horizon, like the disc itself
    const H = atmosphere.uHazeHeight.value
    const tau =
      (atmosphere.uHazeDensity.value * H * Math.exp(-s.height / H)) / Math.max(Math.sin(moon.altitude), 0.015)
    const above = THREE.MathUtils.smoothstep(moon.altitude, -0.01, 0.01)
    const k = moon.fraction * above * s.moonGain
    atmosphere.uMoonLight.value.setRGB(
      MOON_COLOR.r * k * Math.exp(-0.6 * tau),
      MOON_COLOR.g * k * Math.exp(-tau),
      MOON_COLOR.b * k * Math.exp(-1.6 * tau)
    )

    color(water.uniforms.uWaterColor.value, s.waterColor, s.waterLevel)
    water.uniforms.uRippleGain.value = s.ripple
    water.uniforms.uSwellGain.value = s.swell
    water.uniforms.uGlintDensity.value = 0.03 * s.glints

    boats.setBrightness(s.brightness)
    boats.setHalo(s.halo)

    renderer.toneMappingExposure = s.exposure
    camera.fov = s.fov
    camera.position.set(0, s.height, 0)
    camera.rotation.set(0, 0, 0)
    resize()
  }

  function loadNight() {
    night = generateNight(hash, source)
    Object.assign(settings, DEFAULTS, night.settings)
    boats.rebuild(night.boats)
    apply()
    controls.showNight(night)

    const url = new URL(location.href)
    url.searchParams.set('h', hash)
    url.searchParams.set('src', source)
    history.replaceState(null, '', url)
  }

  const controls = createControls(settings, {
    onChange: apply,
    onNewNight: () => {
      hash = randomHash()
      loadNight()
    },
    onSource: (value) => {
      source = value
      loadNight()
    },
    onReset: loadNight
  })
  loadNight()
  window.addEventListener('resize', resize)

  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime()
    water.uniforms.uTime.value = t
    boats.update(t, settings.swell, camera)
    renderer.render(scene, camera)
  })
}

export { initOcean }
