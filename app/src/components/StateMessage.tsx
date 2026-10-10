// A full-sheet state: what went wrong and what to do (no route, offline, nothing to show)
export default function StateMessage({ icon, title, text, children = null }) {
  return (
    <div className="mx-6 mt-7 flex flex-col items-center gap-2.5 pb-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-sunken">{icon}</span>
      <b className="text-[20px] font-bold">{title}</b>
      <p className="max-w-[30ch] text-[15px] text-muted">{text}</p>
      {children}
    </div>
  );
}
