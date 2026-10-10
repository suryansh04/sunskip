import * as THREE from 'three'
import {
  GROUND_BELOW_EYE_M,
  STRETCH_LABEL_MAX_VIEW_WIDTH,
  STRETCH_LABEL_TEXT,
  STRETCH_LABEL_VIEW_HEIGHT,
} from './config.ts'
import { releaseSpriteGeometry } from './sprites.ts'

const CANVAS_WIDTH = 1024
const PILL_HEIGHT_PX = 104
const POINTER_PX = 26
/** Room around the pill for its soft shadow. */
const MARGIN_PX = 10
const CANVAS_HEIGHT = PILL_HEIGHT_PX + POINTER_PX + MARGIN_PX
const FONT_PX = 54
const PADDING_PX = 40
const fontOf = (px: number) =>
  `700 ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`

/**
 * The pill that stands on the path where the next sun/shade stretch begins ("Sun · 620 m"),
 * with a small pointer underneath touching the ground. Pill colour = stretch colour.
 */
export interface StretchLabel {
  readonly sprite: THREE.Sprite
  /** Show the pill with its pointer on the ground at world x/z. */
  show(text: string, color: number, x: number, z: number): void
  hide(): void
  /** Call every frame: keeps the pill the same size on screen however far away it is. */
  fitToView(camera: THREE.PerspectiveCamera): void
  dispose(): void
}

export function createStretchLabel(): StretchLabel {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const context = canvas.getContext('2d')

  // The canvas never changes size (a texture can't be resized once uploaded); the pill is drawn
  // from the left edge and the texture is cropped to it.
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter

  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0.5, 0) // anchored by the pointer's tip
  sprite.renderOrder = 10 // on top of the chevrons and the pin
  sprite.visible = false

  let drawn = ''
  let aspect = 1
  const worldPosition = new THREE.Vector3()

  const draw = (text: string, color: number) => {
    if (!context) return
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    context.font = fontOf(FONT_PX)
    const maxTextWidth = CANVAS_WIDTH - MARGIN_PX * 2 - PADDING_PX * 2
    const naturalWidth = context.measureText(text).width
    if (naturalWidth > maxTextWidth) {
      context.font = fontOf(Math.floor((FONT_PX * maxTextWidth) / naturalWidth))
    }
    const pillWidth = Math.ceil(Math.min(naturalWidth, maxTextWidth) + PADDING_PX * 2)
    const width = pillWidth + MARGIN_PX * 2
    const centreX = width / 2
    const pillTop = MARGIN_PX / 2
    const pillBottom = pillTop + PILL_HEIGHT_PX

    const fill = `#${color.toString(16).padStart(6, '0')}`
    context.save()
    context.shadowColor = 'rgba(0, 0, 0, 0.3)'
    context.shadowBlur = 8
    context.shadowOffsetY = 2
    context.fillStyle = fill
    context.beginPath()
    context.roundRect(MARGIN_PX, pillTop, pillWidth, PILL_HEIGHT_PX, 26)
    context.fill()
    // Pointer: a small triangle under the middle of the pill, its tip on the canvas's bottom edge.
    context.beginPath()
    context.moveTo(centreX - POINTER_PX, pillBottom - 2)
    context.lineTo(centreX + POINTER_PX, pillBottom - 2)
    context.lineTo(centreX, CANVAS_HEIGHT)
    context.closePath()
    context.fill()
    context.restore()

    context.fillStyle = STRETCH_LABEL_TEXT
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, centreX, pillTop + PILL_HEIGHT_PX / 2 + 2)

    texture.repeat.set(width / CANVAS_WIDTH, 1)
    texture.needsUpdate = true
    aspect = width / CANVAS_HEIGHT
  }

  return {
    sprite,
    show(text, color, x, z) {
      const key = `${text}|${color}`
      if (key !== drawn) {
        drawn = key
        draw(text, color)
      }
      sprite.position.set(x, -GROUND_BELOW_EYE_M, z)
      sprite.visible = true
    },
    hide() {
      sprite.visible = false
    },
    fitToView(camera) {
      if (!sprite.visible) return
      const distance = camera.position.distanceTo(sprite.getWorldPosition(worldPosition))
      const viewHeightM = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      const heightFraction = Math.min(
        STRETCH_LABEL_VIEW_HEIGHT,
        (STRETCH_LABEL_MAX_VIEW_WIDTH * camera.aspect) / aspect,
      )
      const heightM = viewHeightM * heightFraction
      sprite.scale.set(heightM * aspect, heightM, 1)
    },
    dispose() {
      texture.dispose()
      material.dispose()
      releaseSpriteGeometry(sprite)
    },
  }
}
