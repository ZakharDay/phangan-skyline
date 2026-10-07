import p5 from 'p5'

function sketch(p) {
  p.setup = () => {
    const container = document.querySelector('.sketchContainer')
    const { width, height } = container.getBoundingClientRect()
    const canvas = p.createCanvas(width, height)
    canvas.parent(container.id)

    p.background(0, 0, 0)
    p.noStroke()
    p.fill(0, 0, 255)
  }

  p.draw = () => {}

  p.mouseMoved = () => {
    p.circle(p.mouseX, p.mouseY, 10)
  }
}

function initSketch() {
  console.log('Test')
  new p5(sketch)
}

export { initSketch }
