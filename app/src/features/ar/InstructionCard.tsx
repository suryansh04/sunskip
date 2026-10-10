export type GpsQuality = 'good' | 'fair' | 'poor'
export type CardIcon = 'straight' | 'left' | 'right' | 'arrived' | 'gps'

/** What the top card shows. Plain strings so it only re-renders when something visibly changes. */
export interface CardInfo {
  icon: CardIcon
  /** "Continue west · 100 m" */
  title: string
  /** "then turn left" */
  subtitle: string
  /** "2 min sun"; null hides the status row. */
  sun: string | null
  gps: GpsQuality | null
}

const GPS_DOT: Record<GpsQuality, string> = {
  good: 'bg-green-500',
  fair: 'bg-amber-400',
  poor: 'bg-red-500',
}

const GPS_LABEL: Record<GpsQuality, string> = {
  good: 'GPS good',
  fair: 'GPS fair',
  poor: 'GPS poor',
}

const ICON_PATHS: Record<CardIcon, string> = {
  straight: 'M12 21V4m-6.5 6.5L12 4l6.5 6.5',
  // Drawn as a right turn; the left turn is the same path mirrored.
  right: 'M7 21v-8a4 4 0 0 1 4-4h8.5m-4.5-4.5L19.5 9 15 13.5',
  left: 'M7 21v-8a4 4 0 0 1 4-4h8.5m-4.5-4.5L19.5 9 15 13.5',
  arrived: 'M5 12.5l4.5 4.5L19 7.5',
  gps: 'M12 3v3m0 12v3M3 12h3m12 0h3m-3 0a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
}

/**
 * The dark card across the top of the AR view: a big direction icon and two lines of
 * instruction, with sun minutes and GPS quality in a slim row underneath.
 */
export default function InstructionCard({ info }: { info: CardInfo }) {
  return (
    <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex flex-col items-end gap-1.5">
      <div className="flex w-full items-center gap-4 rounded-2xl bg-[#1d1814]/95 px-5 py-3.5 text-white shadow-lg">
        <svg
          viewBox="0 0 24 24"
          className={`size-11 shrink-0 ${info.icon === 'left' ? '-scale-x-100' : ''} ${info.icon === 'gps' ? 'animate-pulse' : ''}`}
          aria-hidden="true"
        >
          <path
            d={ICON_PATHS[info.icon]}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[clamp(1.2rem,6.4vw,1.75rem)] font-extrabold tracking-tight">
            {info.title}
          </div>
          {info.subtitle && <div className="truncate text-sm text-white/75">{info.subtitle}</div>}
        </div>
      </div>

      {(info.sun !== null || info.gps !== null) && (
        <div className="flex items-center gap-2 rounded-full bg-[#1d1814]/70 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
          {info.sun !== null && (
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 24 24" className="size-3.5 text-amber-300" aria-hidden="true">
                <circle cx="12" cy="12" r="5" fill="currentColor" />
                <path
                  d="M12 1.5v3m0 15v3M1.5 12h3m15 0h3M4.6 4.6l2.1 2.1m10.6 10.6 2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {info.sun}
            </span>
          )}
          {info.gps !== null && (
            <span
              role="img"
              aria-label={GPS_LABEL[info.gps]}
              title={GPS_LABEL[info.gps]}
              className={`size-2.5 rounded-full ring-1 ring-white/80 ${GPS_DOT[info.gps]}`}
            />
          )}
        </div>
      )}
    </div>
  )
}
