// The main action is ink with white text; `ghost` is the quieter secondary button
export default function Button({ children, onClick, ghost = false, disabled = false, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[14px] px-4 text-center text-[17px] font-[650] disabled:opacity-50 ${ghost ? "bg-sunken text-ink" : "bg-ink text-white"} ${className}`}
    >
      {children}
    </button>
  );
}
