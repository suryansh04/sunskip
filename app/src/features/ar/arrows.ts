import * as THREE from 'three'
import {
  ARROW_ARM_M,
  ARROW_BELOW_EYE_M,
  ARROW_BOB_M,
  ARROW_DOUBLE_ARM_M,
  ARROW_DOUBLE_GAP_M,
  ARROW_EDGE_M,
  ARROW_GROW_EXPONENT,
  ARROW_GROW_FROM_M,
  ARROW_GROW_MAX,
  ARROW_LENGTH_M,
  ARROW_OUTLINE_M,
  ARROW_PULSE_AMOUNT,
  ARROW_SHADOW_OPACITY,
  ARROW_SHADOW_SCALE,
  ARROW_SIDE_SHADE,
  ARROW_THICKNESS_M,
  ARROW_TILT_FAR_DEG,
  ARROW_TILT_FAR_M,
  ARROW_TILT_NEAR_DEG,
  ARROW_TILT_NEAR_M,
  ARROW_TILT_SIDEWAYS_DEG,
  ARROW_WIDTH_M,
  COLOR_EDGE,
  COLOR_OUTLINE,
  GROUND_BELOW_EYE_M,
} from './config.ts'
import { chevronOutline, outset } from './shapes.ts'

/** Front-to-back drop from a chevron's tip to its shoulders. */
const CHEVRON_RISE_M = ARROW_LENGTH_M - ARROW_ARM_M
const DOUBLE_LENGTH_M = CHEVRON_RISE_M + ARROW_DOUBLE_ARM_M * 2 + ARROW_DOUBLE_GAP_M

/** One chevron arrow with its outline and ground shadow. Made by an ArrowKit and reused. */
export interface Arrow {
  /** Put the arrow at world x/z, pointing along a compass bearing. */
  place(x: number, z: number, bearingDeg: number): void
  setColor(color: number): void
  /** Double chevron, used for the next arrow only. */
  setDouble(double: boolean): void
  /** 0 hides the arrow altogether. */
  setOpacity(opacity: number): void
  /**
   * Call every frame with the viewer's x/z: sizes the arrow for its distance and leans it
   * towards the viewer. `pulsePhase` (radians) makes it pulse and bob; null keeps it still.
   */
  animate(viewerX: number, viewerZ: number, pulsePhase: number | null): void
}

/** Builds arrows that share their geometry and shadow texture. */
export interface ArrowKit {
  create(parent: THREE.Object3D): Arrow
  dispose(): void
}

/** How much bigger than life an arrow is drawn at this distance from the viewer. */
export function arrowGrowth(distanceM: number): number {
  return THREE.MathUtils.clamp(
    (distanceM / ARROW_GROW_FROM_M) ** ARROW_GROW_EXPONENT,
    1,
    ARROW_GROW_MAX,
  )
}

/** A chevron outline with its tip at (0, tipY) pointing towards +Y, anticlockwise. */
function chevron(tipY: number, armM: number): THREE.Vector2[] {
  return chevronOutline(ARROW_WIDTH_M, tipY, CHEVRON_RISE_M, armM)
}

/** Extrude outlines drawn in XY into a slab lying flat, centred on y = 0, pointing along -Z. */
function slab(polygons: readonly THREE.Vector2[][], thicknessM: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(
    polygons.map((polygon) => new THREE.Shape(polygon)),
    { depth: thicknessM, bevelEnabled: false },
  )
  geometry.translate(0, 0, -thicknessM / 2)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * The coloured body. MeshBasicMaterial has no lighting, so the side walls get a darker vertex
 * colour: that is what makes the arrow read as a solid shape.
 */
function bodyGeometry(polygons: readonly THREE.Vector2[][]): THREE.ExtrudeGeometry {
  const geometry = slab(polygons, ARROW_THICKNESS_M)
  const shades = new Float32Array(geometry.getAttribute('position').count * 3).fill(1)
  for (const group of geometry.groups) {
    // ExtrudeGeometry puts caps in material group 0 and side walls in group 1.
    if (group.materialIndex === 1) {
      shades.fill(ARROW_SIDE_SHADE, group.start * 3, (group.start + group.count) * 3)
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(shades, 3))
  geometry.clearGroups()
  return geometry
}

/**
 * A slightly larger copy of the body, drawn inside-out (back faces only) behind it, shows as an
 * outline of even width from any angle.
 */
function shellGeometry(polygons: readonly THREE.Vector2[][], by: number): THREE.ExtrudeGeometry {
  return slab(
    polygons.map((polygon) => outset(polygon, by)),
    ARROW_THICKNESS_M + by * 2,
  )
}

function variant(polygons: readonly THREE.Vector2[][]) {
  return {
    body: bodyGeometry(polygons),
    outline: shellGeometry(polygons, ARROW_OUTLINE_M),
    edge: shellGeometry(polygons, ARROW_OUTLINE_M + ARROW_EDGE_M),
  }
}

/** Soft round blob, opaque in the middle and clear at the rim. */
function shadowTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.7)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  return new THREE.CanvasTexture(canvas)
}

export function createArrowKit(): ArrowKit {
  const single = variant([chevron(ARROW_LENGTH_M / 2, ARROW_ARM_M)])
  const double = variant([
    chevron(DOUBLE_LENGTH_M / 2, ARROW_DOUBLE_ARM_M),
    chevron(DOUBLE_LENGTH_M / 2 - ARROW_DOUBLE_ARM_M - ARROW_DOUBLE_GAP_M, ARROW_DOUBLE_ARM_M),
  ])
  const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const shadowMap = shadowTexture()
  const materials: THREE.Material[] = []

  return {
    create(parent) {
      // Materials are per arrow because each arrow has its own colour and fades on its own.
      const bodyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true })
      const outlineMaterial = new THREE.MeshBasicMaterial({
        color: COLOR_OUTLINE,
        side: THREE.BackSide,
      })
      const edgeMaterial = new THREE.MeshBasicMaterial({ color: COLOR_EDGE, side: THREE.BackSide })
      const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        map: shadowMap,
        transparent: true,
        depthWrite: false,
      })
      const solid = [edgeMaterial, outlineMaterial, bodyMaterial]
      materials.push(...solid, shadowMaterial)

      const edge = new THREE.Mesh(single.edge, edgeMaterial)
      const outline = new THREE.Mesh(single.outline, outlineMaterial)
      const body = new THREE.Mesh(single.body, bodyMaterial)
      // Only matters while the arrow is fading: draw back to front.
      edge.renderOrder = 2
      outline.renderOrder = 3
      body.renderOrder = 4

      // The arrow is drawn on an invisible board that leans back towards the viewer, whichever
      // way the arrow itself points. (Tilting about the arrow's own axis would turn an arrow
      // seen from the side into an unreadable sliver.) `group` is the board, `shape` the arrow
      // turned to its bearing within it.
      const shape = new THREE.Group()
      shape.add(edge, outline, body)
      const group = new THREE.Group()
      group.rotation.order = 'YXZ' // face the viewer first, then lean back
      group.add(shape)
      group.visible = false

      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
      shadow.position.y = 0.02 - GROUND_BELOW_EYE_M // just above the ribbon
      shadow.renderOrder = 1
      shadow.visible = false

      parent.add(shadow, group)
      let lengthM = ARROW_LENGTH_M
      let bearingRad = 0

      return {
        place(x, z, bearingDeg) {
          bearingRad = THREE.MathUtils.degToRad(bearingDeg)
          group.position.x = x
          group.position.z = z
          shadow.position.x = x
          shadow.position.z = z
          // Compass bearings run clockwise, three.js yaw anticlockwise.
          shadow.rotation.y = -bearingRad
        },
        setColor(color) {
          bodyMaterial.color.setHex(color)
        },
        setDouble(isDouble) {
          const shapes = isDouble ? double : single
          body.geometry = shapes.body
          outline.geometry = shapes.outline
          edge.geometry = shapes.edge
          lengthM = isDouble ? DOUBLE_LENGTH_M : ARROW_LENGTH_M
        },
        setOpacity(opacity) {
          group.visible = opacity > 0
          shadow.visible = opacity > 0
          for (const material of solid) {
            material.opacity = opacity
            material.transparent = opacity < 1
          }
          shadowMaterial.opacity = ARROW_SHADOW_OPACITY * opacity
        },
        animate(viewerX, viewerZ, pulsePhase) {
          const east = group.position.x - viewerX
          const south = group.position.z - viewerZ
          const distanceM = Math.hypot(east, south)
          const viewBearingRad = Math.atan2(east, -south)
          group.rotation.y = -viewBearingRad
          shape.rotation.y = viewBearingRad - bearingRad

          const grow = arrowGrowth(distanceM)
          const pulse =
            pulsePhase === null ? 1 : 1 + ARROW_PULSE_AMOUNT * (0.5 - 0.5 * Math.cos(pulsePhase))
          group.scale.setScalar(grow * pulse)
          const tiltForDistance = THREE.MathUtils.mapLinear(
            THREE.MathUtils.clamp(distanceM, ARROW_TILT_NEAR_M, ARROW_TILT_FAR_M),
            ARROW_TILT_NEAR_M,
            ARROW_TILT_FAR_M,
            ARROW_TILT_NEAR_DEG,
            ARROW_TILT_FAR_DEG,
          )
          // An arrow pointing across the view (a turn ahead) stands up more, like a road sign.
          const sideways = Math.abs(Math.sin(shape.rotation.y))
          group.rotation.x = THREE.MathUtils.degToRad(
            THREE.MathUtils.lerp(
              tiltForDistance,
              Math.max(tiltForDistance, ARROW_TILT_SIDEWAYS_DEG),
              sideways,
            ),
          )
          group.position.y =
            -ARROW_BELOW_EYE_M + (pulsePhase === null ? 0 : ARROW_BOB_M * Math.sin(pulsePhase))
          shadow.scale.set(
            ARROW_WIDTH_M * ARROW_SHADOW_SCALE * grow,
            1,
            lengthM * ARROW_SHADOW_SCALE * grow,
          )
        },
      }
    },
    dispose() {
      for (const shapes of [single, double]) {
        shapes.body.dispose()
        shapes.outline.dispose()
        shapes.edge.dispose()
      }
      shadowGeometry.dispose()
      shadowMap.dispose()
      materials.forEach((material) => material.dispose())
      materials.length = 0
    },
  }
}
