import type { ArDebugInfo } from './ARView.tsx'
import { compassPoint } from './status.ts'

interface ArDebugBoxProps {
  info: ArDebugInfo | null
  desk: boolean
  /** Shown at the end of the last line, e.g. which route is loaded. */
  note: string
}

/** Developer readout for ARView, shown under the instruction card when the URL has ?debug=1. */
export default function ArDebugBox({ info, desk, note }: ArDebugBoxProps) {
  return (
    <pre className="pointer-events-none fixed top-[calc(max(0.75rem,env(safe-area-inset-top))+7.5rem)] left-2 rounded-lg bg-black/75 px-3 py-2 font-mono text-xs leading-5 text-white">
      {info ? (
        <>
          {`progress ${Math.round(info.progressM)} / ${Math.round(info.routeLengthM)} m\n`}
          {desk
            ? 'gps      fake (desk mode)\n'
            : `gps      ${info.accuracyM === null ? 'no fix yet' : `±${Math.round(info.accuracyM)} m`} · ${info.fixCount} fixes\n`}
          {info.position === null
            ? 'route    waiting for a position\n'
            : info.snapped
              ? `route    snapped (fix was ${info.offRouteM.toFixed(1)} m off)\n`
              : `route    OFF ROUTE by ${Math.round(info.offRouteM)} m\n`}
          {`facing   ${Math.round(info.facingDeg)}° ${compassPoint(info.facingDeg)} · path ${Math.round(info.routeBearingDeg)}° ${compassPoint(info.routeBearingDeg)}\n`}
          {`align    compass ${Math.round(info.compassDeg)}° ${info.headingOffsetDeg >= 0 ? '+' : '-'} ${Math.abs(Math.round(info.headingOffsetDeg))}°\n`}
          {`showing  ${info.gated ? '2D compass (GPS poor)' : '3D arrows'}\n`}
          {`render   ${Math.round(info.fps)} fps · ${info.drawCalls} draw calls\n`}
          {`route    ${note}`}
        </>
      ) : (
        'starting…'
      )}
    </pre>
  )
}
