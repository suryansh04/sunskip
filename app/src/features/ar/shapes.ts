import * as THREE from 'three'

/** How far a sharp corner of an outline may stick out, as a multiple of the outline width. */
const MITER_LIMIT = 2.5

/**
 * A chevron outline in XY with its tip at (0, tipY) pointing towards +Y, anticlockwise.
 * `rise` is the drop from the tip to the shoulders, `arm` the thickness of each arm.
 */
export function chevronOutline(
  widthM: number,
  tipY: number,
  riseM: number,
  armM: number,
): THREE.Vector2[] {
  const half = widthM / 2
  const shoulderY = tipY - riseM
  return [
    new THREE.Vector2(0, tipY),
    new THREE.Vector2(-half, shoulderY),
    new THREE.Vector2(-half, shoulderY - armM),
    new THREE.Vector2(0, tipY - armM),
    new THREE.Vector2(half, shoulderY - armM),
    new THREE.Vector2(half, shoulderY),
  ]
}

/** Grow an anticlockwise polygon outwards by `by`, keeping its corners sharp. */
export function outset(polygon: readonly THREE.Vector2[], by: number): THREE.Vector2[] {
  const count = polygon.length
  return polygon.map((vertex, i) => {
    const before = polygon[(i + count - 1) % count]
    const after = polygon[(i + 1) % count]
    const inDirection = vertex.clone().sub(before).normalize()
    const outDirection = after.clone().sub(vertex).normalize()
    // Outward normals of the two edges that meet here; their sum points along the corner.
    const corner = new THREE.Vector2(inDirection.y, -inDirection.x).add(
      new THREE.Vector2(outDirection.y, -outDirection.x),
    )
    const reach = Math.min(2 / Math.max(corner.lengthSq(), 1e-6), MITER_LIMIT / corner.length())
    return vertex.clone().addScaledVector(corner, by * reach)
  })
}
