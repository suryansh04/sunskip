/** Something the walker can tap in the sheet's message line. */
export type SheetAction =
  | 'recalibrate'
  | 'undo-align'
  | 'confirm-align'
  | 'cancel-align'
  | 'reload'
  | 'enable-motion'
  | 'use-arrow'

/** The line of help or status under the Map | AR control. */
export interface SheetMessage {
  tone: 'normal' | 'warning' | 'error'
  /** Bold first line, for states that need one ("Permission denied"). */
  title?: string
  text: string
  actions: readonly { id: SheetAction; label: string }[]
}

interface BottomSheetProps {
  message: SheetMessage
  onAction: (action: SheetAction) => void
  /** Without it the Map tab is shown but can't be tapped. */
  onSwitchToMap?: () => void
  /** Without it there is no close button. */
  onClose?: () => void
}

const TONE: Record<SheetMessage['tone'], string> = {
  normal: 'text-[#4a4038]',
  warning: 'rounded-xl bg-amber-100 px-3 py-2 text-amber-950',
  error: 'rounded-xl bg-red-50 px-3 py-2 text-red-900',
}

/**
 * The white panel at the bottom of the AR view: Map | AR switch, close button, and one line of
 * help or status (finding GPS, weak GPS, permissions, re-align) with its action links.
 */
export default function BottomSheet({
  message,
  onAction,
  onSwitchToMap,
  onClose,
}: BottomSheetProps) {
  return (
    <div className="rounded-[1.75rem] bg-white p-3 shadow-2xl">
      <div className="flex items-stretch gap-3">
        <div role="tablist" aria-label="View" className="flex grow gap-1 rounded-2xl bg-[#f3ede6] p-1">
          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled={!onSwitchToMap}
            onClick={onSwitchToMap}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl text-lg font-semibold text-[#5c514a] active:bg-black/5 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path
                d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
            Map
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d1814] text-lg font-semibold text-white"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path
                d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8m8 0h2.5A1.5 1.5 0 0 1 20 5.5V8m0 8v2.5a1.5 1.5 0 0 1-1.5 1.5H16m-8 0H5.5A1.5 1.5 0 0 1 4 18.5V16m8-8.5 4 2.25v4.5L12 16.5l-4-2.25v-4.5L12 7.5Zm0 4.5 4-2.25M12 12v4.5M12 12 8 9.75"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            AR
          </button>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close AR"
            onClick={onClose}
            className="flex w-16 shrink-0 items-center justify-center rounded-2xl bg-[#fde2e0] text-[#d63b3b] active:bg-[#fbcfcb]"
          >
            <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      <div className={`mx-1 mt-3 mb-1 text-center text-[0.95rem] leading-snug ${TONE[message.tone]}`}>
        {message.title && <div className="font-semibold">{message.title}</div>}
        <div>{message.text}</div>
        {message.actions.length > 0 && (
          <div className="mt-1.5 flex justify-center gap-5">
            {message.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onAction(action.id)}
                className="min-h-8 font-semibold text-[#2463b4] active:opacity-60"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
