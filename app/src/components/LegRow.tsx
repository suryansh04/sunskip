const ICON_PX = 19;

// One step of the legs timeline: a round icon, the line down to the next step, a title and a detail line
export default function LegRow({ dot, rail, title, detail, hot = false, children = null }) {
  return (
    <span className="relative flex w-full items-start gap-3 pt-2 pb-3.5">
      {rail && <i className={`absolute top-10 -bottom-1.5 left-[17px] w-0.5 ${rail}`} />}
      <span className={`relative z-[1] grid size-9 flex-none place-items-center rounded-full ${dot.style}`}>
        <dot.Icon size={ICON_PX} weight="bold" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[16px] leading-[1.3] font-[650]">{title}</b>
        <span className={`block text-[14px] ${hot ? "font-semibold text-sun-text" : "text-muted"}`}>{detail}</span>
        {children}
      </span>
    </span>
  );
}
