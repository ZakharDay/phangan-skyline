import * as THREE from 'three'
import { mulberry32, swellAt } from './waves.js'

// Thai squid-fishing boats: wooden hull, cabin aft, and rows of bright lamps
// hung on booms over the deck to lure squid at night.

const MAX_BOAT_LIGHTS = 48

const BOAT_LENGTH = 16
const BOAT_BEAM = 4.2
const LAMPS_PER_ROW = 6

// Brightness of the lamp sprites, of their reflection on the water
// and of the light they cast on their own hull
const SPRITE_GAIN = 40
const WATER_GAIN = 5
const HULL_GAIN = 2

const LAMP_COLORS = {
  green: new THREE.Color(0.25, 1.0, 0.42),
  white: new THREE.Color(0.8, 0.95, 1.0),
  cyan: new THREE.Color(0.55, 0.95, 1.0),
  warm: new THREE.Color(1.0, 0.8, 0.55),
  red: new THREE.Color(1.0, 0.28, 0.16)
}

const HULL_COLORS = [0x1f4f8f, 0x2f7a4a, 0x8a2a24, 0x2a6f8a, 0x2c3e66]

// Hull shape along its length, t = 0 at the stern, t = 1 at the bow
function hullStation(t) {
  const bow = 1 - Math.pow(Math.max(t - 0.5, 0) / 0.5, 1.7)
  const stern = 0.85 + 0.15 * Math.min(t / 0.1, 1)
  return {
    z: (t - 0.5) * BOAT_LENGTH,
    halfBeam: Math.max((BOAT_BEAM / 2) * bow * stern, 0.03),
    sheer: 1.25 + 2.2 * Math.pow(t, 3.2) + 0.3 * Math.pow(1 - t, 3),
    keel: -0.75 + 1.4 * Math.pow(t, 5)
  }
}

const BULWARK = 0.4

function hullGeometry() {
  const ST = 32
  const SEG = 14
  const pos = []
  const idx = []

  // Outer shell: elliptic U-sections lofted along the length
  for (let i = 0; i <= ST; i++) {
    const s = hullStation(i / ST)
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG - 0.5) * Math.PI
      pos.push(
        s.halfBeam * Math.sin(a),
        s.keel + (s.sheer - s.keel) * (1 - Math.cos(a)),
        s.z
      )
    }
  }
  for (let i = 0; i < ST; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j
      const b = a + SEG + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  // Transom: fan closing the stern section
  const s0 = hullStation(0)
  const center = pos.length / 3
  pos.push(0, (s0.keel + s0.sheer) / 2, s0.z)
  for (let j = 0; j < SEG; j++) idx.push(center, j + 1, j)

  // Inner side of the bulwarks, down to the deck
  const base = pos.length / 3
  for (let i = 0; i <= ST; i++) {
    const s = hullStation(i / ST)
    for (const side of [-1, 1]) {
      pos.push(side * s.halfBeam, s.sheer, s.z)
      pos.push(side * s.halfBeam * 0.92, s.sheer - BULWARK, s.z)
    }
  }
  for (let i = 0; i < ST; i++) {
    for (let k = 0; k < 2; k++) {
      const a = base + i * 4 + k * 2
      const b = a + 4
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function deckGeometry() {
  const ST = 32
  const pos = []
  const idx = []
  for (let i = 0; i <= ST; i++) {
    const s = hullStation(i / ST)
    const y = s.sheer - BULWARK
    pos.push(-s.halfBeam * 0.92, y, s.z, s.halfBeam * 0.92, y, s.z)
  }
  for (let i = 0; i < ST; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function deckHeight(t) {
  const s = hullStation(t)
  return s.sheer - BULWARK
}

const hullVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

// Lit by the sky, the sun or moon, and the boat's own lamps
const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform samplerCube uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uLampPos;
  uniform vec3 uLampColor;

  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    // the part under water is hidden by the far water plane, which doesn't write depth
    if (vWorld.y < 0.0) discard;

    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;

    vec3 sky = textureCube(uSky, vec3(0.0, 1.0, 0.0)).rgb;
    vec3 light = sky * (0.55 + 0.45 * N.y);
    light += uSunColor * max(dot(N, normalize(uSunDir)), 0.0) / 3.14159;

    vec3 Lv = uLampPos - vWorld;
    float r2 = dot(Lv, Lv);
    light += uLampColor * max(dot(N, Lv * inversesqrt(r2)), 0.0) / (r2 + 1.0);

    gl_FragColor = vec4(uColor * light, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Lamp sprites: a tiny bright core with a halo and lens star spikes,
// sized by how much light actually reaches the camera
const spriteVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aPower;

  uniform float uPxPerRad;
  uniform float uPx;
  uniform float uGain;

  varying vec3 vColor;
  varying float vEnergy;
  varying float vSize;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vEnergy = uGain * aPower / (d * d) * uPxPerRad * uPxPerRad * exp(-d / 30000.0);
    vColor = aColor;
    float radius = 5.0 * log(max(sqrt(vEnergy), 1.0)) + 4.0;
    vSize = clamp(2.0 * radius, 8.0, 96.0) * uPx;
    gl_PointSize = vSize;
    gl_Position = projectionMatrix * mv;
  }
`

const spriteFragment = /* glsl */ `
  uniform float uPx;

  varying vec3 vColor;
  varying float vEnergy;
  varying float vSize;

  void main() {
    vec2 q = (gl_PointCoord - 0.5) * vSize / uPx; // offset in CSS pixels
    float r = length(q);

    float sig = 0.7;
    float core = vEnergy / (6.2832 * sig * sig) * exp(-r * r / (2.0 * sig * sig));
    // halo and spikes grow slower than the core, like a lens glare
    float glare = sqrt(vEnergy);
    float halo = glare * (0.05 * exp(-r / 1.5) + 0.004 * exp(-r / 6.0));

    // 8-ray star
    float a = atan(q.y, q.x);
    float toRay = mod(a + 0.3927, 0.7854) - 0.3927;
    float perp = r * abs(sin(toRay));
    float spikes = glare * 0.05 * exp(-perp * perp / 0.3) * exp(-r / 4.0);

    vec3 col = mix(vColor, vec3(1.0), 0.5) * core + vColor * (halo + spikes);
    col *= smoothstep(0.5, 0.4, length(gl_PointCoord - 0.5));

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function layout() {
  const rand = mulberry32(21)

  // A few boats close enough to see the hull, like in the photo
  const boats = [
    { x: -70, z: -330, heading: 1.25, colors: ['red', 'green'], power: 1 },
    { x: 160, z: -720, heading: -1.9, colors: ['cyan'], power: 1 },
    { x: -330, z: -1350, heading: 1.8, colors: ['green'], power: 1.2 }
  ]

  const palette = ['green', 'green', 'green', 'white', 'cyan', 'warm']
  const scatter = (count, near, far, spread) => {
    for (let i = 0; i < count; i++) {
      const z = -(near + rand() * (far - near))
      const color = palette[Math.floor(rand() * palette.length)]
      boats.push({
        x: (rand() * 2 - 1) * spread * -z,
        z,
        heading: rand() * Math.PI * 2,
        colors: [color],
        power: 1 + rand() * 1.5
      })
    }
  }
  scatter(5, 2000, 5000, 0.35) // middle distance
  scatter(18, 7000, 22000, 0.42) // a line of lights along the horizon

  return boats
}

function createBoats(shared) {
  const root = new THREE.Group()
  const hullGeo = hullGeometry()
  const deckGeo = deckGeometry()
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)

  const lampLocal = []
  const lampColors = []
  const lampPowers = []

  const lightPos = []
  const lightColor = []

  const boats = layout().map((def, n) => {
    const group = new THREE.Group()
    group.position.set(def.x, 0, def.z)
    root.add(group)

    const lampUniforms = {
      uLampPos: { value: new THREE.Vector3() },
      uLampColor: { value: new THREE.Color() }
    }
    const material = (hex) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(hex) },
          uSky: shared.uSky,
          uSunDir: shared.uSunDir,
          uSunColor: shared.uSunColor,
          ...lampUniforms
        },
        vertexShader: hullVertex,
        fragmentShader: hullFragment,
        side: THREE.DoubleSide
      })

    const part = (geo, hex, sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(geo, material(hex))
      m.scale.set(sx, sy, sz)
      m.position.set(x, y, z)
      m.renderOrder = 2
      group.add(m)
      return m
    }

    const hull = new THREE.Mesh(hullGeo, material(HULL_COLORS[n % HULL_COLORS.length]))
    hull.renderOrder = 2
    group.add(hull)
    const deck = new THREE.Mesh(deckGeo, material(0x6e5238))
    deck.renderOrder = 2
    group.add(deck)

    // Cabin with roof aft, masts, and two booms carrying the lamps
    const L = BOAT_LENGTH
    const cabinDeck = deckHeight(0.2)
    part(boxGeo, 0xe6e1d3, 2.8, 2.0, 3.6, 0, cabinDeck + 1.0, -L * 0.28)
    part(boxGeo, 0x2b5f9e, 3.2, 0.15, 4.2, 0, cabinDeck + 2.07, -L * 0.28)
    part(poleGeo, 0x3a3a3a, 0.16, 7.5, 0.16, 0, deckHeight(0.65) + 3.75, L * 0.15)
    part(poleGeo, 0x3a3a3a, 0.12, 3.5, 0.12, 0, cabinDeck + 3.8, -L * 0.25)
    const boomY = 4.4
    for (const side of [-1, 1]) {
      part(boxGeo, 0x3a3a3a, 0.08, 0.08, L * 0.66, side * 1.15, boomY, L * 0.06)
    }

    // Lamps hang just under the booms
    const lamps = []
    // colors are spread along the boat from stern to bow
    for (const side of [-1, 1]) {
      for (let i = 0; i < LAMPS_PER_ROW; i++) {
        const colorName = def.colors[Math.floor((i / LAMPS_PER_ROW) * def.colors.length)]
        const z = L * (-0.25 + (0.63 * i) / (LAMPS_PER_ROW - 1))
        lamps.push({ local: new THREE.Vector3(side * 1.15, boomY - 0.3, z), colorName })
        lampLocal.push(lamps[lamps.length - 1].local)
        lampColors.push(LAMP_COLORS[colorName])
        lampPowers.push(def.power)
      }
    }

    // One reflected light per lamp color, so the water loop stays short
    const groups = {}
    for (const lamp of lamps) {
      groups[lamp.colorName] ??= { count: 0, centroid: new THREE.Vector3() }
      groups[lamp.colorName].count++
      groups[lamp.colorName].centroid.add(lamp.local)
    }
    const reflected = Object.entries(groups)
      .filter(() => lightPos.length < MAX_BOAT_LIGHTS)
      .map(([colorName, g]) => {
        const slot = lightPos.length
        lightPos.push(new THREE.Vector3())
        lightColor.push(new THREE.Vector3())
        return {
          slot,
          local: g.centroid.divideScalar(g.count),
          color: LAMP_COLORS[colorName].clone().multiplyScalar(g.count * def.power * WATER_GAIN)
        }
      })

    const lampCenter = new THREE.Vector3()
    const lampTint = new THREE.Color()
    for (const lamp of lamps) {
      lampCenter.add(lamp.local)
      lampTint.add(LAMP_COLORS[lamp.colorName])
    }
    lampCenter.divideScalar(lamps.length)
    lampTint.multiplyScalar(def.power * HULL_GAIN)

    return {
      def,
      group,
      lamps,
      reflected,
      lampUniforms,
      lampCenter,
      lampTint,
      yaw: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), def.heading),
      phase: n * 1.7
    }
  })

  // Pad the uniform arrays to their declared size
  while (lightPos.length < MAX_BOAT_LIGHTS) {
    lightPos.push(new THREE.Vector3())
    lightColor.push(new THREE.Vector3())
  }
  const lightCount = boats.reduce((n, b) => n + b.reflected.length, 0)

  // Lamp sprites
  const positions = new Float32Array(lampLocal.length * 3)
  const colors = new Float32Array(lampLocal.length * 3)
  lampColors.forEach((c, i) => c.toArray(colors, i * 3))
  const spriteGeo = new THREE.BufferGeometry()
  const positionAttr = new THREE.BufferAttribute(positions, 3)
  positionAttr.setUsage(THREE.DynamicDrawUsage)
  spriteGeo.setAttribute('position', positionAttr)
  spriteGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  spriteGeo.setAttribute('aPower', new THREE.Float32BufferAttribute(lampPowers, 1))

  const spriteUniforms = {
    uPxPerRad: { value: 1000 },
    uPx: { value: 1 },
    uGain: { value: SPRITE_GAIN }
  }
  const sprites = new THREE.Points(
    spriteGeo,
    new THREE.ShaderMaterial({
      uniforms: spriteUniforms,
      vertexShader: spriteVertex,
      fragmentShader: spriteFragment,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true
    })
  )
  sprites.frustumCulled = false
  sprites.renderOrder = 3
  root.add(sprites)

  let lightsOn = 1
  const up = new THREE.Vector3(0, 1, 0)
  const normal = new THREE.Vector3()
  const tilt = new THREE.Quaternion()
  const v = new THREE.Vector3()

  function update(t) {
    let lamp = 0
    for (const boat of boats) {
      const { x, z } = boat.def

      // Ride the swell; a long hull averages out the short waves a bit
      const s = swellAt(x, z, t)
      const sway = 0.012 * Math.sin(t * 0.7 + boat.phase)
      normal.set(-s.sx * 0.7 + sway, 1, -s.sz * 0.7).normalize()
      tilt.setFromUnitVectors(up, normal)
      boat.group.quaternion.copy(tilt).multiply(boat.yaw)
      boat.group.position.y = s.h
      boat.group.updateMatrixWorld()

      const m = boat.group.matrixWorld
      for (const l of boat.lamps) {
        v.copy(l.local).applyMatrix4(m).toArray(positions, lamp * 3)
        lamp++
      }
      for (const r of boat.reflected) {
        lightPos[r.slot].copy(r.local).applyMatrix4(m)
        lightColor[r.slot].set(r.color.r, r.color.g, r.color.b).multiplyScalar(lightsOn)
      }
      boat.lampUniforms.uLampPos.value.copy(boat.lampCenter).applyMatrix4(m)
      boat.lampUniforms.uLampColor.value.copy(boat.lampTint).multiplyScalar(lightsOn)
    }
    positionAttr.needsUpdate = true
  }

  function setLightsOn(on) {
    lightsOn = on ? 1 : 0
    sprites.visible = on
  }

  function resize(camera, height, pixelRatio) {
    const fov = THREE.MathUtils.degToRad(camera.fov)
    spriteUniforms.uPxPerRad.value = height / (2 * Math.tan(fov / 2))
    spriteUniforms.uPx.value = pixelRatio
  }

  return { object: root, lightPos, lightColor, lightCount, update, setLightsOn, resize }
}

export { createBoats, MAX_BOAT_LIGHTS }
