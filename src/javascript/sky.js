import * as THREE from 'three'
import { atmosphereGLSL } from './atmosphere.js'

// Moonless, starless night sky: dark navy overhead, the air near the horizon
// glowing teal from the lamps of the fishing fleet

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // always at camera.far
  }
`

const fragmentShader = /* glsl */ `
  ${atmosphereGLSL}

  varying vec3 vWorldPosition;

  void main() {
    vec3 rd = normalize(vWorldPosition - cameraPosition);
    gl_FragColor = vec4(skyRadiance(cameraPosition, rd), 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function createSky(atmosphere) {
  const sky = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.ShaderMaterial({
      uniforms: { ...atmosphere },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false
    })
  )
  sky.scale.setScalar(450000)
  // drawn after the water and boats, so only the pixels where the sky is visible get shaded
  sky.renderOrder = 10
  sky.frustumCulled = false
  return sky
}

export { createSky }
