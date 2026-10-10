// A 46 px white circle for an icon. `flat` drops the shadow when it isn't floating over the map.
export default function RoundButton({ label, onClick, children, flat = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`press grid size-[46px] flex-none place-items-center rounded-full bg-white ${flat ? "" : "shadow-[0_2px_10px_rgba(40,25,10,.16)]"}`}
    >
      {children}
    </button>
  );
}
