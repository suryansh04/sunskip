import type * as THREE from 'three'

/**
 * Every THREE.Sprite shares one geometry that three.js keeps for the life of the page, and each
 * renderer that draws a sprite hangs a dispose-listener on it. Those listeners hold on to the
 * renderer, so its WebGL context and canvas would never be freed. Disposing the shared geometry
 * runs and removes the listeners. Call this before the renderer is disposed; three.js rebuilds
 * the geometry's buffers by itself if a sprite is drawn again.
 */
export function releaseSpriteGeometry(sprite: THREE.Sprite): void {
  sprite.geometry.dispose()
}
