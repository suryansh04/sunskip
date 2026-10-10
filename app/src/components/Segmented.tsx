// One of a few options, with a pill that slides to the chosen one (design.md §4).
// Light: white pill on sunken (Leave now / Leave at / Arrive by). `dark`: ink pill (Map / AR).
export default function Segmented({ options, value, onChange, label, dark = false, className = "" }) {
  const chosen = Math.max(0, options.findIndex((option) => option.value === value));
  const inset = dark ? 4 : 3;

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`relative grid bg-sunken ${dark ? "min-h-14 rounded-[14px] p-1" : "rounded-xl p-[3px]"} ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <span
        className={`absolute transition-transform duration-300 ease-soft ${dark ? "inset-y-1 left-1 rounded-[11px] bg-ink" : "inset-y-[3px] left-[3px] rounded-[10px] bg-white shadow-[0_1px_3px_rgba(40,25,10,.14)]"}`}
        style={{ width: `calc((100% - ${inset * 2}px) / ${options.length})`, transform: `translateX(${chosen * 100}%)` }}
      />
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={i === chosen}
          onClick={() => onChange(option.value)}
          className={`relative z-[1] flex items-center justify-center gap-2 text-center font-[650] transition-colors duration-[250ms] ${dark ? "rounded-[11px] text-[16px]" : "min-h-[42px] rounded-[10px] text-[15px] font-semibold"} ${i === chosen ? (dark ? "text-white" : "text-ink") : "text-muted"}`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
