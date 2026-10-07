import * as THREE from 'three'
import { createAtmosphere } from './atmosphere.js'
import { createSky } from './sky.js'
import { createWater } from './water.js'
import { createBoats } from './boats.js'
import { loadSettings, createControls } from './controls.js'

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

  const settings = loadSettings()
  const color = (target, hex, level) => target.set(hex).multiplyScalar(level)

  function resize() {
    const { width, height } = container.getBoundingClientRect()
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    boats.resize(camera, height, renderer.getPixelRatio())
  }

  function apply(key) {
    const s = settings

    atmosphere.uHazeDensity.value = 2e-5 * Math.pow(150, s.humidity)
    atmosphere.uHazeHeight.value = s.hazeHeight
    atmosphere.uMistDensity.value = s.mist * 0.02
    atmosphere.uMistHeight.value = s.mistHeight
    color(atmosphere.uSkyZenith.value, s.skyZenith, s.skyZenithLevel)
    color(atmosphere.uSkyGlow.value, s.skyGlow, s.skyGlowLevel)

    color(water.uniforms.uWaterColor.value, s.waterColor, s.waterLevel)
    water.uniforms.uRippleGain.value = s.ripple
    water.uniforms.uSwellGain.value = s.swell

    boats.setBrightness(s.brightness)
    boats.setHalo(s.halo)

    renderer.toneMappingExposure = s.exposure
    camera.fov = s.fov
    camera.position.set(0, s.height, 0)
    camera.rotation.x = THREE.MathUtils.degToRad(s.pitch)
    resize()

    // boat distances come from the photo and the camera height
    if (['all', 'photoBoats', 'horizonBoats', 'height'].includes(key)) {
      boats.rebuild(s, s.height)
    }
  }

  apply('all')
  createControls(settings, apply)
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
