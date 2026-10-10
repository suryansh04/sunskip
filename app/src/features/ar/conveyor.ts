import * as THREE from 'three'
import {
  CONVEYOR_CHEVRON_ARM_M,
  CONVEYOR_CHEVRON_LENGTH_M,
  CONVEYOR_CHEVRON_WIDTH_M,
  CONVEYOR_FADE_IN_M,
  CONVEYOR_FADE_OUT_M,
  CONVEYOR_FAR_BRIGHTNESS,
  CONVEYOR_FAR_GROW,
  CONVEYOR_FAR_M,
  CONVEYOR_NEAR_BOOST,
  CONVEYOR_NEAR_BOOST_UNTIL_M,
  CONVEYOR_NEAR_M,
  CONVEYOR_OUTLINE_M,
  CONVEYOR_SPACING_M,
  CONVEYOR_SPEED_M_PER_S,
  CONVEYOR_TILT_FAR_DEG,
  CONVEYOR_TILT_FROM_M,
  CONVEYOR_TILT_FULL_M,
  GROUND_BELOW_EYE_M,
} from './config.ts'
import { chevronOutline, outset } from './shapes.ts'

const MAX_CHEVRONS = Math.ceil((CONVEYOR_FAR_M - CONVEYOR_NEAR_M) / CONVEYOR_SPACING_M) + 2
/** Lifts the coloured fill just above its white outline. */
const FILL_LIFT_M = 0.004

/** A point of the route in world coordinates, with its distance along the route. */
export interface PathPoint {
  x: number
  z: number
  alongM: number
}

/**
 * The arrows on the path: a stream of flat chevrons that flows forward along the route like a
 * travelator, so the motion itself shows the way. All chevrons are instances of one mesh: one
 * draw call however many are showing.
 */
export interface Conveyor {
  readonly mesh: THREE.InstancedMesh
  /**
   * The route in world coordinates, and the colour of each piece between two points
   * (`colors[i]` for points[i] to points[i + 1]). Call once the world origin is known.
   */
  setPath(points: readonly PathPoint[], colors: readonly number[]): void
  /** Call every frame with how far along the route the walker is. */
  update(dtSeconds: number, progressM: number): void
  dispose(): void
}

/**
 * One flat chevron lying on the ground, tip towards -Z: a white outline with the coloured fill
 * on top. `outline` is 1 on the outline's vertices and 0 on the fill's.
 */
function chevronGeometry(): THREE.BufferGeometry {
  const fill = chevronOutline(
    CONVEYOR_CHEVRON_WIDTH_M,
    CONVEYOR_CHEVRON_LENGTH_M / 2,
    CONVEYOR_CHEVRON_LENGTH_M - CONVEYOR_CHEVRON_ARM_M,
    CONVEYOR_CHEVRON_ARM_M,
  )
  // The outline comes first in the index list, so the fill is drawn over it.
  const layers = [
    { geometry: new THREE.ShapeGeometry(new THREE.Shape(outset(fill, CONVEYOR_OUTLINE_M))), outline: 1, lift: 0 },
    { geometry: new THREE.ShapeGeometry(new THREE.Shape(fill)), outline: 0, lift: FILL_LIFT_M },
  ]
  const positions: number[] = []
  const outlineFlags: number[] = []
  const indices: number[] = []
  for (const layer of layers) {
    const base = positions.length / 3
    const layerPositions = layer.geometry.getAttribute('position')
    for (let i = 0; i < layerPositions.count; i++) {
      // Shape is drawn in XY with the tip at +Y: lay it down so +Y becomes -Z and it faces up.
      positions.push(layerPositions.getX(i), layer.lift, -layerPositions.getY(i))
      outlineFlags.push(layer.outline)
    }
    const layerIndex = layer.geometry.getIndex()
    if (layerIndex) {
      for (let i = 0; i < layerIndex.count; i++) indices.push(base + layerIndex.getX(i))
    }
    layer.geometry.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('outline', new THREE.Float32BufferAttribute(outlineFlags, 1))
  geometry.setIndex(indices)
  return geometry
}

/**
 * MeshBasicMaterial with two small additions: outline vertices stay white instead of taking the
 * instance colour, and each instance has its own opacity (`fade`) so chevrons can fade in and out.
 */
function conveyorMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float outline;\nattribute float fade;\nvarying float vOutline;\nvarying float vFade;',
      )
      .replace('#include <color_vertex>', '#include <color_vertex>\nvOutline = outline;\nvFade = fade;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOutline;\nvarying float vFade;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vOutline);\ndiffuseColor.a *= vFade;',
      )
  }
  // The shader differs from a plain MeshBasicMaterial's, so it must not share its cached program.
  material.customProgramCacheKey = () => 'sunskip-conveyor'
  return material
}

const smoothstep = THREE.MathUtils.smoothstep

export function createConveyor(): Conveyor {
  const geometry = chevronGeometry()
  const fades = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHEVRONS), 1)
  fades.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('fade', fades)
  const material = conveyorMaterial()

  const mesh = new THREE.InstancedMesh(geometry, material, MAX_CHEVRONS)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.setColorAt(0, new THREE.Color()) // creates the per-instance colour buffer
  mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage)
  mesh.position.y = -GROUND_BELOW_EYE_M
  mesh.frustumCulled = false // instances move every frame; they are always ahead of the walker
  mesh.count = 0

  let points: readonly PathPoint[] = []
  let colors: readonly number[] = []
  /** Where the chevron pattern starts, in metres along the route; grows with time. */
  let flowM = 0

  // Scratch objects, reused every frame.
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const scale = new THREE.Vector3()
  const color = new THREE.Color()

  return {
    mesh,
    setPath(nextPoints, nextColors) {
      points = nextPoints
      colors = nextColors
    },
    update(dtSeconds, progressM) {
      flowM = (flowM + dtSeconds * CONVEYOR_SPEED_M_PER_S) % CONVEYOR_SPACING_M
      if (points.length < 2) {
        mesh.count = 0
        return
      }
      const routeEndM = points[points.length - 1].alongM
      const nearM = progressM + CONVEYOR_NEAR_M
      const farM = Math.min(progressM + CONVEYOR_FAR_M, routeEndM)
      // Chevrons sit at flowM + k * spacing along the route, so they belong to the ground (they
      // don't jump when a GPS update moves the walker) and all drift forward together.
      let alongM = flowM + Math.ceil((nearM - flowM) / CONVEYOR_SPACING_M) * CONVEYOR_SPACING_M
      let segment = 0
      let count = 0
      for (; alongM <= farM && count < MAX_CHEVRONS; alongM += CONVEYOR_SPACING_M) {
        while (segment < points.length - 2 && points[segment + 1].alongM < alongM) segment++
        const a = points[segment]
        const b = points[segment + 1]
        const length = b.alongM - a.alongM
        const t = length > 0 ? THREE.MathUtils.clamp((alongM - a.alongM) / length, 0, 1) : 0
        const dx = b.x - a.x
        const dz = b.z - a.z
        position.set(a.x + dx * t, 0, a.z + dz * t)

        const aheadM = alongM - progressM
        const tilt = THREE.MathUtils.degToRad(
          CONVEYOR_TILT_FAR_DEG * smoothstep(aheadM, CONVEYOR_TILT_FROM_M, CONVEYOR_TILT_FULL_M),
        )
        // Point the chevron's tip (-Z) along this piece of the route, then lean it back.
        euler.set(tilt, Math.atan2(-dx, -dz), 0)
        rotation.setFromEuler(euler)
        const nearBoost =
          1 + CONVEYOR_NEAR_BOOST * (1 - smoothstep(aheadM, CONVEYOR_NEAR_M, CONVEYOR_NEAR_BOOST_UNTIL_M))
        const farGrow = THREE.MathUtils.lerp(
          1,
          CONVEYOR_FAR_GROW,
          smoothstep(aheadM, CONVEYOR_NEAR_BOOST_UNTIL_M, CONVEYOR_FAR_M),
        )
        scale.setScalar(nearBoost * farGrow)
        mesh.setMatrixAt(count, matrix.compose(position, rotation, scale))

        const brightness = THREE.MathUtils.lerp(1, CONVEYOR_FAR_BRIGHTNESS, aheadM / CONVEYOR_FAR_M)
        mesh.setColorAt(count, color.setHex(colors[segment] ?? 0xffffff).multiplyScalar(brightness))
        // Fade in at the near end and out at the far end, so looping and the end of the route
        // never make a chevron pop in or out.
        fades.setX(
          count,
          smoothstep(aheadM, CONVEYOR_NEAR_M, CONVEYOR_NEAR_M + CONVEYOR_FADE_IN_M) *
            (1 - smoothstep(alongM, farM - CONVEYOR_FADE_OUT_M, farM)),
        )
        count++
      }
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      fades.needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      mesh.dispose()
    },
  }
}
