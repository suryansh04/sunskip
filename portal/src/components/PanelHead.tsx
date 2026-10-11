// The big condensed heading and the one-sentence finding at the top of each side panel
export default function PanelHead({ title, children }) {
  return (
    <div className="border-b-2 border-ink px-6.5 pt-5.5 pb-4.5">
      <h1 className="cond text-[64px] leading-[0.9]">{title}</h1>
      <p className="mt-3 max-w-[48ch] [&_b]:font-[750]">{children}</p>
    </div>
  );
}
