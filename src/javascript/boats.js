import * as THREE from 'three'
import { mulberry32, swellAt } from './waves.js'
import { atmosphereGLSL, MAX_FOG_LIGHTS } from './atmosphere.js'
import { MAX_REFLECTED_LIGHTS } from './water.js'

// Thai squid-fishing boats: wooden hull, cabin aft, long net poles over the side,
// and a few very bright lamps that lure squid at night.

const BOAT_LENGTH = 16
const BOAT_BEAM = 4.2

// Brightness of the lamp sprites, of their reflection on the water,
// of the glow they make in the humid air, and of the light on their own hull
const SPRITE_GAIN = 25
const WATER_GAIN = 1000
const FOG_GAIN = 1500
const HULL_GAIN = 2

// Boats closer than this get a reflection column per lamp, farther ones one per color
const PER_LAMP_REFLECTION_DISTANCE = 5000

const LAMP_COLORS = {
  green: new THREE.Color(0.25, 1.0, 0.42),
  white: new THREE.Color(0.85, 0.97, 1.0),
  cyan: new THREE.Color(0.55, 0.95, 1.0),
  blue: new THREE.Color(0.45, 0.62, 1.0),
  warm: new THREE.Color(1.0, 0.72, 0.4),
  red: new THREE.Color(1.6, 0.4, 0.2)
}

const HULL_COLORS = [0x1f4f8f, 0x2f7a4a, 0x8a2a24, 0x2a6f8a, 0x2c3e66]

// Boats picked out of the wide reference photo (2000x1500, horizon at y = 572),
// nearest first. Pixel positions are turned into distances from the camera height.
const PHOTO_BOATS = [
  { px: 420, py: 715, type: 'pair', colors: ['white', 'red'], heading: Math.PI / 2 },
  { px: 690, py: 625, type: 'pair', colors: ['cyan'] },
  { px: 1660, py: 626, type: 'ends', colors: ['green'] },
  { px: 110, py: 633, type: 'ends', colors: ['green'], power: 0.5 },
  { px: 1940, py: 610, type: 'row', colors: ['green', 'warm'] },
  { px: 365, py: 602, type: 'pair', colors: ['white'] },
  { px: 995, py: 596, type: 'pair', colors: ['white', 'cyan'] },
  { px: 1295, py: 586, type: 'pair', colors: ['blue'] },
  { px: 325, py: 586, type: 'ends', colors: ['white'] },
  { px: 1100, py: 582, type: 'ends', colors: ['cyan'] }
]
const PHOTO = { width: 2000, horizon: 572, pxPerRad: 1472, tanHalfWidth: 0.679 }

// Lamp power per type: a pair of big lamps, two at the ends, or a row of smaller ones
const LAMP_POWER = { pair: 4, ends: 3, row: 1.6 }

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

function deckHeight(t) {
  return hullStation(t).sheer - BULWARK
}

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
      pos.push(s.halfBeam * Math.sin(a), s.keel + (s.sheer - s.keel) * (1 - Math.cos(a)), s.z)
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

// Lit by the glowing sky and the boat's own lamps, then seen through the haze
const hullFragment = /* glsl */ `
  ${atmosphereGLSL}

  uniform vec3 uColor;
  uniform vec3 uLampPos;
  uniform vec3 uLampColor;

  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    // the part under water would show through the water planes
    if (vWorld.y < 0.0) discard;

    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;

    vec3 light = uSkyGlow * (0.5 + 0.5 * N.y);
    vec3 Lv = uLampPos - vWorld;
    float r2 = dot(Lv, Lv);
    light += uLampColor * max(dot(N, Lv * inversesqrt(r2)), 0.0) / (r2 + 1.0);

    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 color = applyAtmosphere(uColor * light, cameraPosition, -toEye / dist, dist);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Lamp sprites: a small bright core and a soft halo that swells in humid air
const spriteVertex = /* glsl */ `
  ${atmosphereGLSL}

  attribute vec3 aColor;
  attribute float aPower;

  uniform float uPxPerRad;
  uniform float uPx;
  uniform float uGain;

  varying vec3 vColor;
  varying float vEnergy;
  varying float vSize;
  varying float vHaze;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 toLamp = wp.xyz - cameraPosition;
    float d = length(toLamp);
    float tau = opticalDepth(cameraPosition, toLamp / d, d);

    vEnergy = uGain * aPower / (d * d) * uPxPerRad * uPxPerRad * exp(-tau);
    vHaze = tau;
    vColor = aColor;

    float spread = 1.0 + 0.6 * min(tau, 4.0);
    float radius = (4.0 + 3.0 * log(1.0 + sqrt(vEnergy))) * spread;
    vSize = clamp(2.0 * radius, 6.0, 160.0) * uPx;
    gl_PointSize = vSize;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const spriteFragment = /* glsl */ `
  uniform float uPx;
  uniform float uHalo;

  varying vec3 vColor;
  varying float vEnergy;
  varying float vSize;
  varying float vHaze;

  void main() {
    vec2 q = (gl_PointCoord - 0.5) * vSize / uPx; // offset in CSS pixels
    float r = length(q);

    float sig = 0.8;
    float core = vEnergy / (6.2832 * sig * sig) * exp(-r * r / (2.0 * sig * sig));

    // the halo grows slower than the core, and spreads out in haze
    float glare = sqrt(vEnergy);
    float spread = 1.0 + 0.6 * min(vHaze, 4.0);
    float halo = glare * uHalo * (0.06 * exp(-r / 1.6) + 0.004 * spread * exp(-r / (3.0 * spread)));

    // fade to zero before the sprite edge so no square or disc outline shows
    float edge = clamp(length(gl_PointCoord - 0.5) * 2.0, 0.0, 1.0);
    float window = (1.0 - edge * edge) * (1.0 - edge * edge);
    vec3 col = (mix(vColor, vec3(1.0), 0.5) * core + vColor * halo) * window;

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Where each boat sits and what kind it is
function layout(settings, cameraHeight) {
  const rand = mulberry32(21)
  const boats = []

  PHOTO_BOATS.slice(0, settings.photoBoats).forEach((b) => {
    const below = (b.py - PHOTO.horizon) / PHOTO.pxPerRad
    const tanAz = ((b.px - PHOTO.width / 2) / (PHOTO.width / 2)) * PHOTO.tanHalfWidth
    const dist = cameraHeight / Math.tan(below)
    boats.push({ ...b, x: dist * tanAz, z: -dist, power: b.power ?? 1 })
  })

  // A line of lights along the horizon, spread evenly across the view
  const colors = ['white', 'white', 'cyan', 'cyan', 'green', 'green', 'green', 'blue']
  const types = ['pair', 'pair', 'ends', 'row']
  const n = settings.horizonBoats
  for (let i = 0; i < n; i++) {
    const az = THREE.MathUtils.degToRad(-50 + (100 * (i + rand())) / n)
    const dist = 9000 + rand() * 15000
    const color = colors[Math.floor(rand() * colors.length)]
    boats.push({
      x: dist * Math.tan(az),
      z: -dist,
      type: types[Math.floor(rand() * types.length)],
      colors: rand() < 0.2 ? [color, colors[Math.floor(rand() * colors.length)]] : [color],
      power: 0.7 + rand() * 0.8
    })
  }

  boats.forEach((b) => {
    b.heading ??= rand() * Math.PI * 2
    b.hullColor = HULL_COLORS[Math.floor(rand() * HULL_COLORS.length)]
  })
  return boats
}

// Local lamp positions for a boat type (bow toward +z)
function lampLayout(def) {
  const L = BOAT_LENGTH
  const y = deckHeight(0.5) + 3.0
  const color = (i) => def.colors[i % def.colors.length]
  if (def.type === 'row') {
    return Array.from({ length: 7 }, (_, i) => ({
      local: new THREE.Vector3(0, y, L * (-0.3 + (0.65 * i) / 6)),
      color: color(i)
    }))
  }
  if (def.type === 'ends') {
    return [
      { local: new THREE.Vector3(0, y, L * -0.3), color: color(0) },
      { local: new THREE.Vector3(0, y + 0.5, L * 0.36), color: color(1) }
    ]
  }
  return [
    { local: new THREE.Vector3(0, y, L * 0.12), color: color(0) },
    { local: new THREE.Vector3(0, y, L * 0.12 - 5), color: color(1) }
  ]
}

function createBoats(atmosphere, water) {
  const root = new THREE.Group()
  const hullGeo = hullGeometry()
  const deckGeo = deckGeometry()
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)
  poleGeo.translate(0, 0.5, 0) // grows from its base along +y

  const spriteUniforms = {
    ...atmosphere,
    uPxPerRad: { value: 1000 },
    uPx: { value: 1 },
    uGain: { value: SPRITE_GAIN },
    uHalo: { value: 1 }
  }
  const spriteMaterial = new THREE.ShaderMaterial({
    uniforms: spriteUniforms,
    vertexShader: spriteVertex,
    fragmentShader: spriteFragment,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true
  })

  let boats = []
  let sprites = null
  let positions = null
  let positionAttr = null
  let brightness = 1

  function material(hex, lampUniforms) {
    return new THREE.ShaderMaterial({
      uniforms: { ...atmosphere, uColor: { value: new THREE.Color(hex) }, ...lampUniforms },
      vertexShader: hullVertex,
      fragmentShader: hullFragment,
      side: THREE.DoubleSide
    })
  }

  function buildBoat(def) {
    const group = new THREE.Group()
    group.position.set(def.x, 0, def.z)
    root.add(group)

    const lampUniforms = {
      uLampPos: { value: new THREE.Vector3() },
      uLampColor: { value: new THREE.Color() }
    }
    const add = (geo, hex) => {
      const m = new THREE.Mesh(geo, material(hex, lampUniforms))
      m.renderOrder = 2
      group.add(m)
      return m
    }
    const box = (hex, sx, sy, sz, x, y, z) => {
      const m = add(boxGeo, hex)
      m.scale.set(sx, sy, sz)
      m.position.set(x, y, z)
    }
    const pole = (hex, radius, from, to) => {
      const m = add(poleGeo, hex)
      const dir = new THREE.Vector3().subVectors(to, from)
      m.scale.set(radius * 2, dir.length(), radius * 2)
      m.position.copy(from)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    }

    add(hullGeo, def.hullColor)
    add(deckGeo, 0x6e5238)

    // Cabin aft, mast, a lamp boom along the deck, and two long net poles over the port side
    const L = BOAT_LENGTH
    const cabinDeck = deckHeight(0.2)
    box(0xe6e1d3, 2.8, 2.0, 3.6, 0, cabinDeck + 1.0, -L * 0.28)
    box(0x2b5f9e, 3.2, 0.15, 4.2, 0, cabinDeck + 2.07, -L * 0.28)
    const mastBase = new THREE.Vector3(0, deckHeight(0.65), L * 0.15)
    pole(0x3a3a3a, 0.08, mastBase, mastBase.clone().add(new THREE.Vector3(0, 7, 0)))
    const boomY = deckHeight(0.5) + 3.3
    box(0x3a3a3a, 0.08, 0.08, L * 0.7, 0, boomY, L * 0.03)
    for (const t of [0.75, 0.35]) {
      const from = new THREE.Vector3(-1.5, deckHeight(t) + 0.8, (t - 0.5) * L)
      const to = from.clone().add(new THREE.Vector3(-10, -0.6, 3.5))
      pole(0xcfc6a8, 0.06, from, to)
    }

    const lamps = lampLayout(def)
    // small red navigation light on the port bow
    const nav = { local: new THREE.Vector3(-1.6, deckHeight(0.85) + 0.6, L * 0.35), color: 'red' }

    const center = new THREE.Vector3()
    const tint = new THREE.Color()
    for (const l of lamps) {
      center.add(l.local)
      tint.add(LAMP_COLORS[l.color])
    }
    center.divideScalar(lamps.length)
    const power = LAMP_POWER[def.type] * def.power

    return {
      def,
      group,
      lamps,
      nav,
      power,
      center,
      tint: tint.multiplyScalar(power),
      lampUniforms,
      dist: Math.hypot(def.x, def.z),
      yaw: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), def.heading),
      phase: boats.length * 1.7
    }
  }

  function rebuild(settings, cameraHeight) {
    root.traverse((o) => {
      if (o.isMesh) o.material.dispose()
    })
    root.clear()
    if (sprites) sprites.geometry.dispose()

    boats = []
    for (const def of layout(settings, cameraHeight)) boats.push(buildBoat(def))
    boats.sort((a, b) => a.dist - b.dist)

    // Reflected lights: per lamp for near boats, per color for the rest
    let slot = 0
    for (const boat of boats) {
      boat.reflected = []
      const groups =
        boat.dist < PER_LAMP_REFLECTION_DISTANCE
          ? boat.lamps.map((l) => ({ color: l.color, locals: [l.local] }))
          : Object.values(
              boat.lamps.reduce((acc, l) => {
                acc[l.color] ??= { color: l.color, locals: [] }
                acc[l.color].locals.push(l.local)
                return acc
              }, {})
            )
      for (const g of groups) {
        if (slot >= MAX_REFLECTED_LIGHTS) break
        const local = g.locals
          .reduce((a, l) => a.add(l), new THREE.Vector3())
          .divideScalar(g.locals.length)
        boat.reflected.push({ slot: slot++, local, color: LAMP_COLORS[g.color], weight: g.locals.length })
      }
    }
    water.uniforms.uLightCount.value = slot

    // Glow in the air: the nearest boats, one light each
    atmosphere.uFogLightCount.value = Math.min(boats.length, MAX_FOG_LIGHTS)

    // Lamp sprites, navigation lights included
    const all = boats.flatMap((b) => [
      ...b.lamps.map((l) => ({ l, power: b.power })),
      { l: b.nav, power: 0.03 }
    ])
    positions = new Float32Array(all.length * 3)
    const colors = new Float32Array(all.length * 3)
    const powers = new Float32Array(all.length)
    all.forEach(({ l, power }, i) => {
      LAMP_COLORS[l.color].toArray(colors, i * 3)
      powers[i] = power
    })
    const geo = new THREE.BufferGeometry()
    positionAttr = new THREE.BufferAttribute(positions, 3)
    positionAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', positionAttr)
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geo.setAttribute('aPower', new THREE.BufferAttribute(powers, 1))
    sprites = new THREE.Points(geo, spriteMaterial)
    sprites.frustumCulled = false
    sprites.renderOrder = 3
    root.add(sprites)
  }

  const up = new THREE.Vector3(0, 1, 0)
  const normal = new THREE.Vector3()
  const tilt = new THREE.Quaternion()
  const v = new THREE.Vector3()

  function update(t, swellGain, camera) {
    let i = 0
    boats.forEach((boat, n) => {
      const { x, z } = boat.def

      // Ride the swell; a long hull averages out the short waves a bit
      const s = swellAt(x, z, t)
      const sway = 0.012 * Math.sin(t * 0.7 + boat.phase)
      normal.set(-s.sx * swellGain * 0.7 + sway, 1, -s.sz * swellGain * 0.7).normalize()
      tilt.setFromUnitVectors(up, normal)
      boat.group.quaternion.copy(tilt).multiply(boat.yaw)
      boat.group.position.y = s.h * swellGain
      boat.group.updateMatrixWorld()
      const m = boat.group.matrixWorld

      for (const l of boat.lamps) v.copy(l.local).applyMatrix4(m).toArray(positions, i++ * 3)
      v.copy(boat.nav.local).applyMatrix4(m).toArray(positions, i++ * 3)

      for (const r of boat.reflected) {
        const p = water.lightPos[r.slot].copy(r.local).applyMatrix4(m)
        // sideways reach of the column and its glow: a few degrees, wider up close
        const dx = p.x - camera.position.x
        const dz = p.z - camera.position.z
        const d = Math.hypot(dx, dz)
        water.lightDir[r.slot].set(dx / d, dz / d, Math.max(0.06, 60 / d))
        const k = r.weight * boat.power * WATER_GAIN * brightness
        water.lightColor[r.slot].set(r.color.r * k, r.color.g * k, r.color.b * k)
      }

      const center = v.copy(boat.center).applyMatrix4(m)
      boat.lampUniforms.uLampPos.value.copy(center)
      boat.lampUniforms.uLampColor.value.copy(boat.tint).multiplyScalar(HULL_GAIN * brightness)

      if (n < MAX_FOG_LIGHTS) {
        atmosphere.uFogLightPos.value[n].copy(center)
        const k = FOG_GAIN * brightness
        atmosphere.uFogLightColor.value[n].set(boat.tint.r * k, boat.tint.g * k, boat.tint.b * k)
      }
    })
    positionAttr.needsUpdate = true
  }

  function setBrightness(value) {
    brightness = value
    spriteUniforms.uGain.value = SPRITE_GAIN * value
  }

  function setHalo(value) {
    spriteUniforms.uHalo.value = value
  }

  function resize(camera, height, pixelRatio) {
    const fov = THREE.MathUtils.degToRad(camera.fov)
    spriteUniforms.uPxPerRad.value = height / (2 * Math.tan(fov / 2))
    spriteUniforms.uPx.value = pixelRatio
  }

  return { object: root, rebuild, update, setBrightness, setHalo, resize }
}

export { createBoats }
