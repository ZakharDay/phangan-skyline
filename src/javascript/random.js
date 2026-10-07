// Deterministic randomness from a single hash string (same format as a Highlight
// transaction hash: 0x + 64 hex chars).
//
// Every part of the scene draws from its own named stream, e.g. stream('group', 2, 'boat', 7),
// so adding a new parameter or changing one group never reshuffles the rest of the picture.

// 128-bit string hash
function cyrb128(str) {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

// Small fast counter PRNG
function sfc32(a, b, c, d) {
  return () => {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

function createRandom(hash) {
  return function stream(...labels) {
    const next = sfc32(...cyrb128(`${hash}:${labels.join(':')}`))
    for (let i = 0; i < 12; i++) next()

    const rng = {
      float: next,
      range: (min, max) => min + (max - min) * next(),
      int: (min, max) => min + Math.floor((max - min + 1) * next()),
      bool: (p) => next() < p,
      pick: (list) => list[Math.floor(next() * list.length)],
      // { key: weight } -> key
      weighted: (table) => {
        const entries = Object.entries(table)
        let r = next() * entries.reduce((sum, [, w]) => sum + w, 0)
        for (const [key, w] of entries) {
          r -= w
          if (r < 0) return key
        }
        return entries[entries.length - 1][0]
      },
      normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next())
    }
    return rng
  }
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

function randomHash() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ?h=0x... like Highlight's test parameters
function hashFromUrl() {
  const h = new URLSearchParams(location.search).get('h')
  return h && HASH_PATTERN.test(h) ? h.toLowerCase() : null
}

export { createRandom, randomHash, hashFromUrl }
