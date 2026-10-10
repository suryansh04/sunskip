// A whole-panel state: nothing ready yet, can't reach SunSkip, nothing to show
export default function StateMessage({ icon, title, text, children = null }) {
  return (
    <div className="flex animate-enter flex-col items-start gap-3 px-10 py-14">
      {icon}
      <h2 className="cond text-[40px] leading-[0.95]">{title}</h2>
      <p className="max-w-[40ch] text-muted">{text}</p>
      {children}
    </div>
  );
}
