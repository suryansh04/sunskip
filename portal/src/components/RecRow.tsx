import { ChartBar, Cube, Tree, Umbrella } from "@phosphor-icons/react";
import { inr } from "../format";

function shareText(percent) {
  return percent === null ? "unknown" : `${percent}%`;
}

// One recommendation: what to build, its cost, shade on the stretch before → after, people and sun-minutes saved.
// The open row also shows the reason and the two next steps.
export default function RecRow({ rec, rank, name, open, onOpen, onHover, onTry, onEvidence }) {
  const Icon = rec.type === "TREE" ? Tree : Umbrella;
  const before = rec.impact.shadePctBefore;
  const after = rec.impact.shadePctAfter;

  return (
    <article
      onClick={onOpen}
      onMouseEnter={() => onHover(rec.stretchId)}
      onMouseLeave={() => onHover(null)}
      className={`grid cursor-pointer grid-cols-[40px_1fr_128px] gap-x-3 gap-y-1 border-b border-line px-6.5 py-4 transition-colors hover:bg-hover ${open ? "bg-hover" : ""}`}
    >
      <span className="num pt-0.5 text-[23px] leading-none">{rank}</span>
      <div>
        <h3 className="text-[16px] leading-tight font-bold">{name}</h3>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
          <Icon size={15} weight="bold" />
          {rec.type === "TREE" ? `${rec.count} trees` : "1 shelter"} · ₹{inr(rec.costInr)} (estimate)
        </p>
        <div className="mt-2.5">
          <div className="flex items-baseline gap-2 text-[12.5px] text-muted">
            Shade on the stretch
            <span className="num text-[19px] text-ink">
              {shareText(before)} → <em className="text-shade-text not-italic">{shareText(after)}</em>
            </span>
          </div>
          <div className="relative mt-1.5 h-3 bg-sun-tint">
            <span className="absolute inset-y-0 left-0 bg-shade transition-[width] duration-600" style={{ width: `${after || 0}%` }} />
            <span className="absolute inset-y-0 left-0 bg-[#123C78]" style={{ width: `${before || 0}%` }} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-right">
        <div className="flex flex-col">
          <span className="num text-[26px] leading-none">{inr(rec.impact.walkersPerDay)}</span>
          <small className="text-[11.5px] leading-tight text-muted">people a day</small>
        </div>
        <div className="flex flex-col">
          <span className="num text-[26px] leading-none">{inr(rec.impact.sunMinutesSavedPerDay)}</span>
          <small className="text-[11.5px] leading-tight text-muted">sun-minutes saved a day on this stretch</small>
        </div>
      </div>
      {open && (
        <div className="col-start-2 col-end-4 mt-2.5 flex animate-enter flex-col gap-3">
          <p className="text-[13.5px] text-muted">{rec.reason}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTry();
              }}
              className="flex min-h-[38px] items-center gap-2 bg-ink px-3.5 text-[14px] font-bold text-white hover:bg-[#2E2723]"
            >
              <Cube size={17} weight="bold" />
              Try in 3D
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEvidence();
              }}
              className="flex min-h-[38px] items-center gap-2 bg-white px-3.5 text-[14px] font-bold shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-hover"
            >
              <ChartBar size={17} weight="bold" />
              Evidence
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
