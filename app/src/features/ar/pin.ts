import * as THREE from 'three'
import { COLOR_PIN, GROUND_BELOW_EYE_M, PIN_MIN_HEIGHT_M, PIN_VIEW_HEIGHT } from './config.ts'
import { releaseSpriteGeometry } from './sprites.ts'

const CANVAS_WIDTH = 128
const CANVAS_HEIGHT = 176

/** The destination marker: one camera-facing map pin standing on the ground. */
export interface DestinationPin {
  readonly sprite: THREE.Sprite
  place(x: number, z: number): void
  /** Call every frame: keeps the pin readable from far away without it shrinking to a dot. */
  fitToView(camera: THREE.PerspectiveCamera): void
  dispose(): void
}

function pinTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const context = canvas.getContext('2d')
  if (context) {
    const centreX = CANVAS_WIDTH / 2
    const radius = 50
    const headY = 62
    const tipY = CANVAS_HEIGHT - 8
    // Teardrop: a round head tapering to a point at the bottom.
    context.beginPath()
    context.arc(centreX, headY, radius, Math.PI * 0.82, Math.PI * 0.18)
    context.lineTo(centreX, tipY)
    context.closePath()
    context.lineJoin = 'round'
    context.strokeStyle = '#111827'
    context.lineWidth = 14
    context.stroke()
    context.strokeStyle = '#ffffff'
    context.lineWidth = 8
    context.stroke()
    context.fillStyle = `#${COLOR_PIN.toString(16).padStart(6, '0')}`
    context.fill()
    context.beginPath()
    context.arc(centreX, headY, 19, 0, Math.PI * 2)
    context.fillStyle = '#ffffff'
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createDestinationPin(): DestinationPin {
  const texture = pinTexture()
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0.5, 0) // the tip of the pin is its anchor
  sprite.renderOrder = 9 // over the chevrons, under the stretch label
  sprite.visible = false
  const worldPosition = new THREE.Vector3()

  return {
    sprite,
    place(x, z) {
      sprite.position.set(x, -GROUND_BELOW_EYE_M, z)
    },
    fitToView(camera) {
      if (!sprite.visible) return
      const distance = camera.position.distanceTo(sprite.getWorldPosition(worldPosition))
      const viewHeightM = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      const heightM = Math.max(viewHeightM * PIN_VIEW_HEIGHT, PIN_MIN_HEIGHT_M)
      sprite.scale.set((heightM * CANVAS_WIDTH) / CANVAS_HEIGHT, heightM, 1)
    },
    dispose() {
      texture.dispose()
      material.dispose()
      releaseSpriteGeometry(sprite)
    },
  }
}
