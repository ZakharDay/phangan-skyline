import GUI from 'three/addons/libs/lil-gui.module.min.js'

// Prototype control panel. The night (boats, moon, weather, sea) comes from the hash;
// the sliders are only for tuning on top of it and are reset with every new night.

const DEFAULTS = {
  humidity: 0.12,
  hazeHeight: 900,
  mist: 0,
  mistHeight: 12,
  skyZenith: '#53c7ff',
  skyZenithLevel: 0.007,
  skyGlow: '#50ccff',
  skyGlowLevel: 0.042,
  moonGain: 1,

  waterColor: '#61dfff',
  waterLevel: 0.001,
  ripple: 1,
  swell: 1,
  glints: 1,

  brightness: 1,
  halo: 1,

  exposure: 1,
  fov: 54,
  height: 70,
  pitch: -7.2
}

const MOON_SOURCES = { 'Дата минта': 'date', 'Номер токена': 'token' }

function createControls(settings, handlers) {
  const gui = new GUI({ title: 'Настройки' })
  const slider = (folder, key, min, max, step, name) =>
    folder.add(settings, key, min, max, step).name(name).onChange(() => handlers.onChange(key))
  const color = (folder, key, name) =>
    folder.addColor(settings, key).name(name).onChange(() => handlers.onChange(key))

  // Sound starts only on a click: browsers block audio until the user interacts with the page
  const soundFolder = gui.addFolder('Звук')
  const soundState = { volume: -8 }
  const soundButton = soundFolder
    .add(
      {
        toggle: async () => {
          const playing = await handlers.onSoundToggle()
          soundButton.name(playing ? 'Выключить звук' : 'Включить звук')
        }
      },
      'toggle'
    )
    .name('Включить звук')
  soundFolder
    .add(soundState, 'volume', -40, 0, 0.5)
    .name('Громкость, дБ')
    .onChange((db) => handlers.onVolume(db))

  const nightFolder = gui.addFolder('Ночь')
  const nightState = { hash: '', source: 'date' }
  nightFolder.add(nightState, 'hash').name('Хеш').disable()
  nightFolder
    .add(nightState, 'source', MOON_SOURCES)
    .name('Фаза луны по')
    .onChange((source) => handlers.onSource(source))
  nightFolder.add({ next: () => handlers.onNewNight() }, 'next').name('Новая ночь')
  nightFolder
    .add({ link: () => navigator.clipboard?.writeText(location.href).catch(() => {}) }, 'link')
    .name('Скопировать ссылку')
  let traitsFolder = null

  const air = gui.addFolder('Атмосфера').close()
  slider(air, 'humidity', 0, 1, 0.01, 'Влажность')
  slider(air, 'hazeHeight', 50, 3000, 10, 'Высота дымки, м')
  slider(air, 'mist', 0, 1, 0.01, 'Туман у воды')
  slider(air, 'mistHeight', 2, 60, 1, 'Толщина тумана, м')
  color(air, 'skyZenith', 'Небо: цвет')
  slider(air, 'skyZenithLevel', 0, 0.05, 0.0005, 'Небо: яркость')
  color(air, 'skyGlow', 'Засветка: цвет')
  slider(air, 'skyGlowLevel', 0, 0.2, 0.001, 'Засветка: яркость')
  slider(air, 'moonGain', 0, 4, 0.01, 'Луна: яркость')

  const water = gui.addFolder('Вода').close()
  color(water, 'waterColor', 'Цвет')
  slider(water, 'waterLevel', 0, 0.03, 0.0005, 'Яркость')
  slider(water, 'ripple', 0, 3, 0.01, 'Рябь')
  slider(water, 'swell', 0, 2, 0.01, 'Зыбь')
  slider(water, 'glints', 0.05, 5, 0.01, 'Сплошность бликов')

  const lights = gui.addFolder('Огни').close()
  slider(lights, 'brightness', 0, 4, 0.01, 'Яркость ламп')
  slider(lights, 'halo', 0, 4, 0.01, 'Ореол огней')

  const camera = gui.addFolder('Камера').close()
  slider(camera, 'exposure', 0.1, 4, 0.01, 'Экспозиция')
  slider(camera, 'fov', 10, 80, 0.5, 'Угол обзора')
  slider(camera, 'height', 5, 300, 1, 'Высота, м')
  slider(camera, 'pitch', -30, 10, 0.1, 'Наклон')

  gui
    .add(
      {
        copy: () => {
          const text = JSON.stringify({ hash: nightState.hash, source: nightState.source, ...settings }, null, 2)
          navigator.clipboard?.writeText(text).catch(() => {})
          console.log(text)
        }
      },
      'copy'
    )
    .name('Скопировать настройки')
  gui.add({ reset: () => handlers.onReset() }, 'reset').name('Сбросить ползунки')

  function showNight(night) {
    nightState.hash = night.hash
    nightState.source = night.source
    traitsFolder?.destroy()
    traitsFolder = nightFolder.addFolder('Свойства')
    for (const [name, value] of Object.entries(night.traits)) {
      traitsFolder.add({ value }, 'value').name(name).disable()
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay())
  }

  return { showNight }
}

export { DEFAULTS, createControls }
