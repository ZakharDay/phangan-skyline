import * as THREE from 'three'

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

// Height and slope of the swell at a point, same formula as the water vertex shader
// (without the small horizontal Gerstner shift)
function swellAt(x, z, t) {
  let h = 0
  let sx = 0
  let sz = 0
  SWELL.forEach((w, i) => {
    const k = (2 * Math.PI) / w.w
    const c = Math.sqrt(9.81 / k)
    const f = k * (w.x * x + w.y * z - c * t) + i * 1.37
    h += w.z * Math.sin(f)
    const s = w.z * k * Math.cos(f)
    sx += w.x * s
    sz += w.y * s
  })
  return { h, sx, sz }
}

export { mulberry32, SWELL, RIPPLES, swellAt }
