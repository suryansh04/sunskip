// Public entry point of the AR walk feature. Import from here, not from the files inside.
//
// The folder is self-contained: it imports only npm packages (react, three, locar), never
// anything outside src/features/ar, so it can be copied into another app or reached through a
// path alias. See INTEGRATION.md.

export { default as ARView } from './ARView.tsx'
export type { ARViewProps, ArDebugInfo } from './ARView.tsx'
export { default as ArDebugBox } from './ArDebugBox.tsx'
export type { LatLng, Waypoint } from './types.ts'
