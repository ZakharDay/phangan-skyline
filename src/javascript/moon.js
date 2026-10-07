// Moon position and phase for a date and place.
// Low-precision formulas after "Astronomy Answers" (as used in SunCalc): good to a fraction
// of a degree, which is plenty for a picture.

const RAD = Math.PI / 180
const DAY_MS = 86400000
const J1970 = 2440588
const J2000 = 2451545
const OBLIQUITY = RAD * 23.4397

// Synodic month and a reference new moon (2000-01-06 18:14 UTC)
const SYNODIC_MONTH = 29.530588853
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000

const rightAscension = (l, b) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l))
const declination = (l, b) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l))

// Azimuth is measured from south, positive toward west
const azimuth = (H, phi, dec) =>
  Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
const altitude = (H, phi, dec) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))

const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw

function refraction(h) {
  h = Math.max(h, 0)
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179))
}

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d)
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + RAD * 102.9372 + Math.PI
  return { dec: declination(L, 0), ra: rightAscension(L, 0) }
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d)
  const M = RAD * (134.963 + 13.064993 * d)
  const F = RAD * (93.272 + 13.22935 * d)
  const l = L + RAD * 6.289 * Math.sin(M)
  const b = RAD * 5.128 * Math.sin(F)
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) }
}

// altitude in radians above the horizon, bearing in degrees clockwise from north,
// fraction of the disc lit, phase 0..1 (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter),
// and where the sun is (to shade the disc from the right side)
function moonAt(date, lat, lon) {
  const lw = RAD * -lon
  const phi = RAD * lat
  const d = toDays(date)

  const m = moonCoords(d)
  const H = siderealTime(d, lw) - m.ra
  let h = altitude(H, phi, m.dec)
  h += refraction(h)
  const bearing = (azimuth(H, phi, m.dec) / RAD + 180 + 360) % 360

  const s = sunCoords(d)
  const Hs = siderealTime(d, lw) - s.ra
  const sunAltitude = altitude(Hs, phi, s.dec)
  const sunBearing = (azimuth(Hs, phi, s.dec) / RAD + 180 + 360) % 360

  const sdist = 149598000
  const elongation = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  )
  const inc = Math.atan2(sdist * Math.sin(elongation), m.dist - sdist * Math.cos(elongation))
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  )

  return {
    altitude: h,
    bearing,
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
    sunAltitude,
    sunBearing
  }
}

// A moment when the moon is at a given phase, `cycles` months after the reference new moon
function datePhase(cycles, phase) {
  return new Date(REFERENCE_NEW_MOON + (cycles + phase) * SYNODIC_MONTH * DAY_MS)
}

const PHASE_NAMES = [
  'Новолуние',
  'Растущий серп',
  'Первая четверть',
  'Растущая луна',
  'Полнолуние',
  'Убывающая луна',
  'Последняя четверть',
  'Убывающий серп'
]

function phaseName(phase) {
  return PHASE_NAMES[Math.round(phase * 8) % 8]
}

export { moonAt, datePhase, phaseName }
