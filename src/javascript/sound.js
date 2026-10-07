import * as Tone from 'tone'
import { createRandom } from './random.js'

// Ambient sound of the night, built from the same hash and night parameters as the picture:
//   - the sea washing the shore below the hill (rhythm and loudness from the sea state),
//   - a low distant surf,
//   - diesel generators humming on the nearest squid boats, each at its own pitch,
//     placed left or right where the boat is,
//   - now and then a cricket on the hill (not every night, never in fog),
//   - rare slow chords and rare bell notes like glints on the water: the key comes from the hash,
//     the mode from the moon (darker at new moon, brighter at full moon).
// Fog muffles everything and adds a longer echo. Every random choice comes from a named
// stream (layer and event number), so a night always sounds the same.

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_NAMES_RU = ['До', 'До♯', 'Ре', 'Ми♭', 'Ми', 'Фа', 'Фа♯', 'Соль', 'Ля♭', 'Ля', 'Си♭', 'Си']

const SCALES = {
  dark: { steps: [0, 2, 3, 7, 8], name: 'тёмная пентатоника' },
  minor: { steps: [0, 3, 5, 7, 10], name: 'минорная пентатоника' },
  major: { steps: [0, 2, 4, 7, 9], name: 'мажорная пентатоника' }
}

const WEATHER_SOUND = {
  clear: { cutoff: 16000, wet: 0.25, decay: 5 },
  haze: { cutoff: 9000, wet: 0.32, decay: 6 },
  humid: { cutoff: 5000, wet: 0.42, decay: 7.5 },
  fog: { cutoff: 2500, wet: 0.55, decay: 9 }
}

// Slow sea: one swell of noise every 10-22 seconds, rising for several seconds and fading longer
const SEA_SOUND = {
  calm: { level: 0.07, period: [17, 22], bells: 0.04 },
  ripple: { level: 0.12, period: [13, 17], bells: 0.06 },
  breeze: { level: 0.18, period: [10, 13], bells: 0.09 }
}

const PAD_TIMBRE = { green: 'sine', white: 'triangle', mixed: 'sine4' }

// Everything about the sound that follows from the night, without touching the audio engine
function designSound(night) {
  const r = createRandom(night.hash)('sound', 'design')
  const root = r.int(0, 11)
  const scaleKey = night.moon.fraction < 0.3 ? 'dark' : night.moon.fraction < 0.7 ? 'minor' : 'major'
  const scale = SCALES[scaleKey]
  const hour = night.time.hour
  const lateness = hour >= 19 ? hour - 19 : hour + 5 // 0 at 19:00, 9 at 04:00
  // a single cricket at most, and not every night: more likely early in the evening, never in fog
  const crickets = night.conditions.weather !== 'fog' && r.bool(lateness < 4 ? 0.7 : 0.35) ? 1 : 0

  return {
    root,
    scale: scale.steps,
    weather: WEATHER_SOUND[night.conditions.weather],
    sea: SEA_SOUND[night.conditions.sea],
    wavePeriod: r.range(...SEA_SOUND[night.conditions.sea].period),
    timbre: PAD_TIMBRE[night.conditions.palette] ?? 'sine',
    crickets,
    label: `${NOTE_NAMES_RU[root]}, ${scale.name}`
  }
}

function noteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function createSound() {
  let night = null
  let playing = false
  let built = null
  let volume = -8
  let master = null // created on the first click: browsers only allow audio after a user gesture

  function build() {
    const design = designSound(night)
    const stream = createRandom(night.hash)
    const nodes = []
    const keep = (node) => {
      nodes.push(node)
      return node
    }

    // Shared bus: weather muffles the highs and lengthens the echo
    const limiter = keep(new Tone.Limiter(-2).connect(master))
    const reverb = keep(new Tone.Reverb({ decay: design.weather.decay, preDelay: 0.04, wet: design.weather.wet }))
    reverb.connect(limiter)
    const air = keep(new Tone.Filter(design.weather.cutoff, 'lowpass').connect(reverb))
    const bus = keep(new Tone.Gain(1).connect(air))

    // Sea washing the shore: two voices, left and right, slightly out of step
    ;[-0.45, 0.45].forEach((pan, v) => {
      const noise = keep(new Tone.Noise('pink').start())
      const filter = keep(new Tone.Filter(350, 'lowpass'))
      const gain = keep(new Tone.Gain(0))
      const panner = keep(new Tone.Panner(pan).connect(bus))
      noise.chain(filter, gain, panner)
      let wave = 0
      const loop = keep(
        new Tone.Loop((time) => {
          const r = stream('sound', 'wave', v, wave++)
          const start = time + r.range(0, 4)
          const peak = design.sea.level * r.range(0.6, 1.2)
          const rise = r.range(3.5, 6)
          const fall = r.range(7, 11)
          gain.gain.cancelScheduledValues(start)
          gain.gain.linearRampToValueAtTime(peak, start + rise)
          gain.gain.linearRampToValueAtTime(peak * 0.2, start + rise + fall)
          filter.frequency.cancelScheduledValues(start)
          filter.frequency.linearRampToValueAtTime(r.range(550, 1000), start + rise)
          filter.frequency.linearRampToValueAtTime(300, start + rise + fall)
        }, design.wavePeriod)
      )
      loop.start(v * design.wavePeriod * 0.5)
    })

    // Low distant surf, breathing slowly
    {
      const noise = keep(new Tone.Noise('brown').start())
      const filter = keep(new Tone.Filter(140, 'lowpass'))
      const gain = keep(new Tone.Gain(design.sea.level * 0.5))
      noise.chain(filter, gain, bus)
      const lfo = keep(new Tone.LFO(0.015, design.sea.level * 0.3, design.sea.level * 0.7).start())
      lfo.connect(gain.gain)
    }

    // Generators of the nearest boats: a low buzz with a slow beat, panned to the boat
    night.boats
      .map((b) => ({ ...b, dist: Math.hypot(b.x, b.z) }))
      .filter((b) => b.dist < 2500)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .forEach((boat, n) => {
        const r = stream('sound', 'generator', n)
        const f0 = r.range(45, 62)
        const level = Math.min(0.02, 7 / boat.dist)
        // camera looks along -z, so x is to the right
        const pan = Math.max(-0.9, Math.min(0.9, boat.x / Math.hypot(boat.x, boat.z) * 1.6))
        const filter = keep(new Tone.Filter(160, 'lowpass'))
        const gain = keep(new Tone.Gain(level))
        const panner = keep(new Tone.Panner(pan).connect(bus))
        filter.chain(gain, panner)
        for (const [mult, detune] of [
          [1, 0],
          [2, r.range(0.2, 0.6)]
        ]) {
          const osc = keep(new Tone.Oscillator(f0 * mult + detune, 'sawtooth').start())
          osc.volume.value = mult === 1 ? 0 : -6
          osc.connect(filter)
        }
      })

    // Crickets on the hill: short pulse trains at their own pitch and pace
    for (let c = 0; c < design.crickets; c++) {
      const r = stream('sound', 'cricket', c)
      const synth = keep(
        new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.003, decay: 0.03, sustain: 0, release: 0.02 }
        })
      )
      synth.volume.value = -36
      const panner = keep(new Tone.Panner(r.range(-0.85, 0.85)).connect(bus))
      synth.connect(panner)
      const pitch = r.range(4200, 5400)
      const pulses = r.int(3, 4)
      // mostly silent: once in a while a short burst of a few chirps
      let chirp = 0
      let burst = 0
      const loop = keep(
        new Tone.Loop((time) => {
          const e = stream('sound', 'cricket', c, chirp++)
          if (burst === 0) {
            if (!e.bool(0.03)) return
            burst = e.int(2, 5)
          }
          burst--
          for (let k = 0; k < pulses; k++) synth.triggerAttackRelease(pitch, 0.02, time + k * 0.045)
        }, r.range(0.9, 1.3))
      )
      loop.start(r.range(0, 1))
    }

    // Slow pad: now and then a chord from the night's scale swells up and fades
    const scaleNote = (degree, octave) => {
      const steps = design.scale
      const d = ((degree % steps.length) + steps.length) % steps.length
      const o = octave + Math.floor(degree / steps.length)
      return 12 * (o + 1) + design.root + steps[d]
    }
    const pad = keep(
      new Tone.PolySynth(Tone.AMSynth, {
        oscillator: { type: design.timbre },
        envelope: { attack: 9, decay: 4, sustain: 0.6, release: 14 },
        modulationEnvelope: { attack: 10, release: 14 }
      })
    )
    pad.volume.value = -30
    pad.connect(bus)
    let chord = 0
    keep(
      new Tone.Loop((time) => {
        const r = stream('sound', 'chord', chord++)
        if (r.bool(0.45)) return // often just the sea
        const degree = r.int(0, 4)
        const notes = [0, 2, 4].map((k) => noteName(scaleNote(degree + k, 3)))
        pad.triggerAttackRelease(notes, 24, time, r.range(0.4, 0.7))
      }, 36).start(2)
    )

    // Bells: rare high notes, like glints catching the eye
    const bell = keep(
      new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 10,
        envelope: { attack: 0.002, decay: 2.5, sustain: 0, release: 2 },
        modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 }
      })
    )
    bell.volume.value = -32
    const bellPan = keep(new Tone.Panner(0).connect(bus))
    bell.connect(bellPan)
    const bellChance = design.sea.bells + (night.moon.visibility === 'В кадре' ? 0.03 : 0)
    let ring = 0
    keep(
      new Tone.Loop((time) => {
        const r = stream('sound', 'bell', ring++)
        if (!r.bool(bellChance)) return
        bellPan.pan.setValueAtTime(r.range(-0.7, 0.7), time)
        bell.triggerAttackRelease(noteName(scaleNote(r.int(0, 9), 5)), 1.5, time, r.range(0.3, 0.6))
      }, 4).start(8)
    )

    return () => {
      for (const node of nodes) node.dispose()
    }
  }

  function rebuild() {
    built?.()
    built = null
    if (playing && night) {
      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      transport.position = 0
      built = build()
      transport.start('+0.1')
    }
  }

  return {
    designSound,
    setNight(value) {
      night = value
      rebuild()
    },
    async toggle() {
      if (!playing) {
        await Tone.start()
        master ??= new Tone.Volume(volume).toDestination()
        playing = true
        rebuild()
      } else {
        playing = false
        Tone.getTransport().stop()
        built?.()
        built = null
      }
      return playing
    },
    setVolume(db) {
      volume = db
      master?.volume.rampTo(db, 0.2)
    }
  }
}

export { createSound, designSound }
