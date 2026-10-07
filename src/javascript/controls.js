import GUI from 'three/addons/libs/lil-gui.module.min.js'

// Prototype control panel. Tuned values are remembered in this browser;
// "Copy settings" puts them on the clipboard so they can become the defaults.

const DEFAULTS = {
  humidity: 0.12,
  hazeHeight: 900,
  mist: 0,
  mistHeight: 12,
  skyZenith: '#53c7ff',
  skyZenithLevel: 0.007,
  skyGlow: '#50ccff',
  skyGlowLevel: 0.042,

  waterColor: '#61dfff',
  waterLevel: 0.001,
  ripple: 1,
  swell: 1,

  photoBoats: 10,
  horizonBoats: 42,
  brightness: 1,
  halo: 1,

  exposure: 1,
  fov: 54,
  height: 70,
  pitch: -7.2
}

const STORAGE_KEY = 'phangan-skyline-settings'

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return { ...DEFAULTS, ...saved }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // storage unavailable, settings just won't persist
  }
}

function createControls(settings, onChange) {
  const gui = new GUI({ title: 'Настройки' })
  const changed = (key) => () => {
    saveSettings(settings)
    onChange(key)
  }
  const slider = (folder, key, min, max, step, name) =>
    folder.add(settings, key, min, max, step).name(name).onChange(changed(key))
  const color = (folder, key, name) => folder.addColor(settings, key).name(name).onChange(changed(key))

  const air = gui.addFolder('Атмосфера')
  slider(air, 'humidity', 0, 1, 0.01, 'Влажность')
  slider(air, 'hazeHeight', 50, 3000, 10, 'Высота дымки, м')
  slider(air, 'mist', 0, 1, 0.01, 'Туман у воды')
  slider(air, 'mistHeight', 2, 60, 1, 'Толщина тумана, м')
  color(air, 'skyZenith', 'Небо: цвет')
  slider(air, 'skyZenithLevel', 0, 0.05, 0.0005, 'Небо: яркость')
  color(air, 'skyGlow', 'Засветка: цвет')
  slider(air, 'skyGlowLevel', 0, 0.2, 0.001, 'Засветка: яркость')

  const water = gui.addFolder('Вода')
  color(water, 'waterColor', 'Цвет')
  slider(water, 'waterLevel', 0, 0.03, 0.0005, 'Яркость')
  slider(water, 'ripple', 0, 3, 0.01, 'Рябь')
  slider(water, 'swell', 0, 2, 0.01, 'Зыбь')

  const boats = gui.addFolder('Лодки')
  slider(boats, 'photoBoats', 0, 10, 1, 'Ближние (с фото)')
  slider(boats, 'horizonBoats', 0, 80, 1, 'У горизонта')
  slider(boats, 'brightness', 0, 4, 0.01, 'Яркость ламп')
  slider(boats, 'halo', 0, 4, 0.01, 'Ореол огней')

  const camera = gui.addFolder('Камера')
  slider(camera, 'exposure', 0.1, 4, 0.01, 'Экспозиция')
  slider(camera, 'fov', 10, 80, 0.5, 'Угол обзора')
  slider(camera, 'height', 5, 300, 1, 'Высота, м')
  slider(camera, 'pitch', -30, 10, 0.1, 'Наклон')

  gui
    .add(
      {
        copy: () => {
          const text = JSON.stringify(settings, null, 2)
          navigator.clipboard?.writeText(text).catch(() => {})
          console.log(text)
        }
      },
      'copy'
    )
    .name('Скопировать настройки')

  gui
    .add(
      {
        reset: () => {
          Object.assign(settings, DEFAULTS)
          saveSettings(settings)
          gui.controllersRecursive().forEach((c) => c.updateDisplay())
          onChange('all')
        }
      },
      'reset'
    )
    .name('Сбросить')

  return gui
}

export { loadSettings, createControls }
