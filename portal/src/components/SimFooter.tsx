import { ArrowCounterClockwise, Eraser, Play } from "@phosphor-icons/react";

// The simulator's actions: run it, go back to the recommended plan, or start from a blank map
export default function SimFooter({ canRun, ranAgain, canReset, onRun, onReset, onStartEmpty }) {
  return (
    <div className="flex border-t-2 border-ink">
      <button
        type="button"
        onClick={onRun}
        disabled={!canRun}
        className="flex min-h-14 flex-1 items-center justify-center gap-2 bg-ink text-[16px] font-bold text-white hover:bg-[#2E2723] disabled:opacity-40"
      >
        <Play size={18} weight="fill" />
        {ranAgain ? "Run again" : "Run simulation"}
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        title="Back to the recommended plan"
        className="flex min-h-14 w-[110px] items-center justify-center gap-2 bg-white font-bold shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-hover disabled:opacity-40"
      >
        <ArrowCounterClockwise size={18} weight="bold" />
        Reset
      </button>
      <button
        type="button"
        onClick={onStartEmpty}
        className="flex min-h-14 w-[140px] items-center justify-center gap-2 bg-white font-bold shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-hover"
      >
        <Eraser size={18} weight="bold" />
        Start empty
      </button>
    </div>
  );
}
