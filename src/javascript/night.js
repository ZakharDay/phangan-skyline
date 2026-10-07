import * as THREE from 'three'
import { createRandom } from './random.js'
import { moonAt, datePhase, phaseName } from './moon.js'

// Turns a hash into one night off Koh Phangan: date and hour, the moon, the weather,
// the sea, and the squid fleet. Everything comes from named random streams, so the same
// hash always gives exactly the same night.

// Hillside on the west coast of Koh Phangan, looking west toward the open gulf
const PLACE = { lat: 9.74, lon: 99.99, utcOffset: 7 }
const CAMERA_BEARING = 270

// World axes: the camera looks down -z (west), so north is +x and east is +z
function bearingToVector(bearingDeg, altitude = 0) {
  const b = THREE.MathUtils.degToRad(bearingDeg)
  return new THREE.Vector3(
    Math.cos(altitude) * Math.cos(b),
    Math.sin(altitude),
    Math.cos(altitude) * Math.sin(b)
  )
}

// Lamp setups seen in the reference photos
const ARCHETYPES = {
  pairWhiteRed: { type: 'pair', colors: ['white', 'red'] },
  pairWhite: { type: 'pair', colors: ['white'] },
  pairCyan: { type: 'pair', colors: ['cyan'] },
  pairBlue: { type: 'pair', colors: ['blue'] },
  pairGreen: { type: 'pair', colors: ['green'] },
  pairWarmGreen: { type: 'pair', colors: ['warm', 'green'] },
  endsGreen: { type: 'ends', colors: ['green'] },
  endsWhite: { type: 'ends', colors: ['white'] },
  rowGreen: { type: 'row', colors: ['green'] },
  rowGreenWarm: { type: 'row', colors: ['green', 'warm'] }
}

// Boats from one harbour tend to carry the same kind of lamps.
// The white-and-red pair is not here: in the photos it is a single boat close under the hill.
const PALETTES = {
  green: { endsGreen: 3, pairGreen: 3, rowGreen: 2, rowGreenWarm: 1 },
  white: { pairWhite: 3, pairCyan: 2, endsWhite: 2, pairBlue: 1 },
  mixed: { pairWhite: 2, endsGreen: 2, rowGreenWarm: 2, pairWarmGreen: 2, pairCyan: 1, pairBlue: 1 }
}

const PALETTE_NAMES = { green: 'Зелёный', white: 'Белый', mixed: 'Смешанный' }

// The mist layer hugging the water is what swallows the lamp columns: the more humid the night,
// the shorter the columns, until in fog only the water right under the boats still shines
const WEATHER = {
  clear: { name: 'Ясно', weight: 50, humidity: [0.05, 0.15], mist: [0, 0.03] },
  haze: { name: 'Дымка', weight: 30, humidity: [0.25, 0.4], mist: [0.07, 0.17] },
  humid: { name: 'Влажно', weight: 15, humidity: [0.45, 0.6], mist: [0.3, 0.5] },
  fog: { name: 'Туман', weight: 5, humidity: [0.65, 0.8], mist: [0.65, 0.9] }
}

const SEA = {
  calm: { name: 'Штиль', weight: 25, ripple: [0.35, 0.55], swell: 0.4 },
  ripple: { name: 'Рябь', weight: 55, ripple: [0.85, 1.15], swell: 1 },
  breeze: { name: 'Бриз', weight: 20, ripple: [1.3, 1.6], swell: 1.3 }
}

const FLEET = {
  few: { name: 'Несколько лодок', weight: 15, count: [5, 10] },
  scattered: { name: 'Разреженный', weight: 35, count: [15, 25] },
  fleet: { name: 'Флот', weight: 35, count: [30, 45] },
  armada: { name: 'Армада', weight: 15, count: [55, 75] }
}

const DISTANCE_BANDS = {
  near: { weight: 20, dist: [700, 2500] },
  mid: { weight: 35, dist: [2500, 7000] },
  far: { weight: 45, dist: [8000, 22000] }
}

const HULL_COLORS = [0x1f4f8f, 0x2f7a4a, 0x8a2a24, 0x2a6f8a, 0x2c3e66]

// Half of the horizontal view where boats are placed, degrees
const VIEW_HALF_WIDTH = 42

const pad = (n) => String(n).padStart(2, '0')

// The night's date and local hour, per moon source:
//   'date'  - the mint date (here simulated from the hash), hour from the hash
//   'token' - the token number picks the day of the lunar cycle
function nightTime(stream, source) {
  const r = stream('time')
  const minutesAfterDusk = r.int(0, 9 * 60) // 19:00 .. 04:00 local
  let tokenId = null
  let day

  if (source === 'token') {
    tokenId = r.int(1, 300)
    const lunarDay = (tokenId - 1) % 30
    day = datePhase(r.int(320, 345), (lunarDay + 0.5) / 30)
  } else {
    day = new Date(Date.UTC(2026, 0, 1) + r.int(0, 2 * 365) * 86400000)
  }

  // local calendar day at 19:00, then shift into the night
  const local = new Date(day.valueOf() + PLACE.utcOffset * 3600000)
  const dusk = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 19) - PLACE.utcOffset * 3600000
  const date = new Date(dusk + minutesAfterDusk * 60000)

  const shown = new Date(date.valueOf() + PLACE.utcOffset * 3600000)
  return {
    date,
    tokenId,
    label: `${shown.getUTCFullYear()}-${pad(shown.getUTCMonth() + 1)}-${pad(shown.getUTCDate())} ${pad(shown.getUTCHours())}:${pad(shown.getUTCMinutes())}`
  }
}

function moonState(date) {
  const m = moonAt(date, PLACE.lat, PLACE.lon)
  const relative = ((m.bearing - CAMERA_BEARING + 540) % 360) - 180
  const up = m.altitude > 0
  const inView = up && Math.abs(relative) < VIEW_HALF_WIDTH && m.altitude < THREE.MathUtils.degToRad(19)
  // how much the moon lights the scene: its lit fraction, fading as it nears the horizon
  const light = m.fraction * THREE.MathUtils.smoothstep(m.altitude, -0.01, 0.12)
  return {
    ...m,
    direction: bearingToVector(m.bearing, m.altitude),
    sunDirection: bearingToVector(m.sunBearing, m.sunAltitude),
    light,
    visibility: inView ? 'В кадре' : up ? 'Над горизонтом' : 'Под горизонтом',
    name: phaseName(m.phase)
  }
}

function placeGroup(stream, g, count, boats, palette) {
  const r = stream('group', g)
  const band = DISTANCE_BANDS[r.weighted(Object.fromEntries(Object.entries(DISTANCE_BANDS).map(([k, b]) => [k, b.weight])))]
  const dist = r.range(...band.dist)
  const bearing = CAMERA_BEARING + r.range(-VIEW_HALF_WIDTH, VIEW_HALF_WIDTH)
  const center = bearingToVector(bearing).multiplyScalar(dist)
  const forward = bearingToVector(bearing)
  const side = new THREE.Vector3(-forward.z, 0, forward.x)
  const spreadSide = dist * r.range(0.04, 0.18)
  const spreadDepth = dist * r.range(0.08, 0.3)
  const heading = r.range(0, Math.PI * 2)
  const main = r.weighted(PALETTES[palette])
  const minSpacing = 120 + dist * 0.012

  for (let j = 0; j < count; j++) {
    const b = stream('group', g, 'boat', j)
    for (let attempt = 0; attempt < 12; attempt++) {
      const p = center
        .clone()
        .addScaledVector(side, b.normal() * spreadSide)
        .addScaledVector(forward, b.normal() * spreadDepth)
      const toBoat = Math.atan2(p.z, p.x) / THREE.MathUtils.DEG2RAD
      const off = ((toBoat - CAMERA_BEARING + 540) % 360) - 180
      const crowded = boats.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < minSpacing)
      if (p.length() < 500 || Math.abs(off) > VIEW_HALF_WIDTH + 5 || crowded) continue

      const archetype = ARCHETYPES[b.bool(0.65) ? main : b.weighted(PALETTES[palette])]
      boats.push({
        x: p.x,
        z: p.z,
        ...archetype,
        heading: heading + b.normal() * 0.3,
        power: b.range(0.7, 1.3),
        hullColor: b.pick(HULL_COLORS),
        palette
      })
      break
    }
  }
}

function generateNight(hash, source = 'date') {
  const stream = createRandom(hash)
  const time = nightTime(stream, source)
  const moon = moonState(time.date)

  const r = stream('conditions')
  const weatherKey = r.weighted(Object.fromEntries(Object.entries(WEATHER).map(([k, w]) => [k, w.weight])))
  const weather = WEATHER[weatherKey]
  const seaKey = r.weighted(Object.fromEntries(Object.entries(SEA).map(([k, s]) => [k, s.weight])))
  const sea = SEA[seaKey]

  // Squid come to the lamps best on dark nights, so a bright moon keeps boats in harbour
  const f = stream('fleet')
  const fleetKey = f.weighted(Object.fromEntries(Object.entries(FLEET).map(([k, s]) => [k, s.weight])))
  const planned = Math.max(3, Math.round(f.int(...FLEET[fleetKey].count) * (1 - 0.55 * moon.light)))
  // part of the fleet is strung along the horizon, the rest works in groups
  const distantCount = Math.round(planned * f.range(0.35, 0.6))
  const groupedCount = planned - distantCount
  const groupCount = Math.max(1, Math.min(f.int(1, 5), groupedCount))

  const palettes = []
  const weights = []
  for (let g = 0; g < groupCount; g++) {
    const gr = stream('group', g, 'setup')
    palettes.push(gr.weighted({ green: 45, white: 32, mixed: 23 }))
    weights.push(gr.range(0.5, 1.5))
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  const boats = []

  // Sometimes one boat works close under the hill, like the white-and-red one in the photos
  const h = stream('hero')
  const hasHero = h.bool(0.45)
  if (hasHero) {
    const bearing = CAMERA_BEARING + h.range(-28, 28)
    const p = bearingToVector(bearing).multiplyScalar(h.range(450, 1100))
    boats.push({
      x: p.x,
      z: p.z,
      ...ARCHETYPES.pairWhiteRed,
      heading: -THREE.MathUtils.degToRad(bearing) + h.range(-0.4, 0.4), // broadside to the camera
      power: 1,
      hullColor: h.pick(HULL_COLORS),
      palette: 'hero'
    })
  }

  palettes.forEach((palette, g) => {
    placeGroup(stream, g, Math.round((groupedCount * weights[g]) / totalWeight), boats, palette)
  })

  // The distant fleet: single boats along the horizon across the whole view, as in every photo
  for (let k = 0; k < distantCount; k++) {
    const b = stream('distant', k)
    const bearing = CAMERA_BEARING + b.range(-VIEW_HALF_WIDTH - 4, VIEW_HALF_WIDTH + 4)
    const p = bearingToVector(bearing).multiplyScalar(b.range(9000, 24000))
    if (boats.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 300)) continue
    const palette = b.pick(palettes)
    boats.push({
      x: p.x,
      z: p.z,
      ...ARCHETYPES[b.weighted(PALETTES[palette])],
      heading: b.range(0, Math.PI * 2),
      power: b.range(0.7, 1.5),
      hullColor: b.pick(HULL_COLORS),
      palette
    })
  }

  // dominant lamp palette among the fleet
  const byPalette = {}
  for (const b of boats) if (b.palette !== 'hero') byPalette[b.palette] = (byPalette[b.palette] ?? 0) + 1
  const dominant = Object.entries(byPalette).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mixed'

  const traits = {
    'Ночь': time.label,
    ...(time.tokenId ? { 'Токен': `#${time.tokenId}` } : {}),
    'Фаза луны': `${moon.name}, ${Math.round(moon.fraction * 100)}%`,
    'Луна': moon.visibility,
    'Погода': weather.name,
    'Море': sea.name,
    'Флот': `${FLEET[fleetKey].name} (${boats.length})`,
    'Групп': String(groupCount),
    'Палитра': PALETTE_NAMES[dominant],
    'Лодка рядом': hasHero ? 'Есть' : 'Нет'
  }

  return {
    hash,
    source,
    time,
    moon,
    boats,
    traits,
    settings: {
      humidity: r.range(...weather.humidity),
      mist: r.range(...weather.mist),
      ripple: r.range(...sea.ripple),
      swell: sea.swell
    }
  }
}

export { generateNight, CAMERA_BEARING }
