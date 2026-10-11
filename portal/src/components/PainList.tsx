import { BANDS, bandOf } from "../bands";
import { LABEL_NOTE, inr, pct, stretchName } from "../format";

// Stretches grouped into Severe / High / Moderate / Low / Unknown bands, worst first.
// Each row: rank, name, % in sun, length, people a day, pain. Hover and click are the page's.
export default function PainList({ rows, hover, onHover, onOpen }) {
  const bands = BANDS.map((band) => ({ ...band, rows: rows.filter((row) => bandOf(row.painScore).key === band.key) })).filter((band) => band.rows.length);

  return (
    <div className="animate-enter">
      {bands.map((band) => (
        <section key={band.key}>
          <div
            className={`sticky top-0 z-[1] flex items-center justify-between px-6.5 py-2 ${band.inkText ? "text-ink" : "text-white"}`}
            style={{ background: band.key === "high" ? band.text : band.color }}
          >
            <b className="cond text-[17px] tracking-[0.01em]">{band.name}</b>
            <span className="text-[12.5px] font-semibold">
              {band.rows.length} {band.rows.length === 1 ? "stretch" : "stretches"} · {inr(band.rows.reduce((sum, row) => sum + (row.walkersPerDay || 0), 0))} people a day
            </span>
          </div>
          {band.rows.map((row) => (
            <button
              key={row.stretchId}
              type="button"
              onMouseEnter={() => onHover(row.stretchId)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onOpen(row.stretchId)}
              className={`grid w-full grid-cols-[40px_1fr_74px_84px_60px] items-center gap-2.5 border-b border-line px-6.5 py-2.5 text-left tabular-nums transition-colors hover:bg-hover ${hover === row.stretchId ? "bg-hover" : ""}`}
            >
              <span className="num text-[23px] leading-none">{row.rank}</span>
              <span className="min-w-0">
                <b title={row.name ? undefined : LABEL_NOTE} className={`block truncate text-[15px] ${row.name ? "font-[650]" : "font-medium text-[#4A4038]"}`}>
                  {stretchName(row)}
                </b>
                <small className="text-[12.5px] text-muted">{pct(row.sunShare)} in direct sun</small>
              </span>
              <span className="text-right text-[14px] leading-tight">
                {inr(row.lengthM)} m<small className="block text-[11px] text-muted">length</small>
              </span>
              <span className="text-right text-[14px] leading-tight">
                {inr(row.walkersPerDay)}
                <small className="block text-[11px] text-muted">people a day</small>
              </span>
              <span className="num text-right text-[29px] leading-none" style={{ color: band.text }}>
                {row.painScore ?? "–"}
              </span>
            </button>
          ))}
        </section>
      ))}
      <p className="px-6.5 pt-4 pb-6 text-[13px] leading-normal text-muted">
        <b className="text-ink">Pain</b> = people a day × share of the path in direct sun × length, scaled so the worst stretch in this area is 100. People a day are estimates from nearby colleges, stops and
        shops, plus SunSkip trips.
      </p>
    </div>
  );
}
