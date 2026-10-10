// The sunken card above the route list: shade data being prepared (with its progress bar) or missing
export default function ShadeNotice({ icon, title, text, done = null, total = null }) {
  return (
    <div className="mx-5 mt-3 rounded-[14px] bg-sunken p-3.5">
      <b className="flex items-center gap-2 text-[16px] font-[650]">
        {icon}
        {title}
      </b>
      <span className="mt-1 block text-[14px] text-muted">{text}</span>
      {total > 0 && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-line">
          <i className="block h-full rounded-[3px] bg-ink transition-[width] duration-300 ease-soft" style={{ width: `${(100 * done) / total}%` }} />
        </div>
      )}
    </div>
  );
}
