import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

// A dropdown in the portal's style (the browser's own <select> list can't be styled): square, ink border,
// the open list's chosen row marked like the area picker. Escape or a click outside closes it.
// options: [{ value, label, note? }]. `up` opens the list above the button (for controls at the bottom of the map).
export default function Dropdown({ value, options, onChange, label, disabled = false, up = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const chosen = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const outside = (event) => !box.current?.contains(event.target) && setOpen(false);
    const escape = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function pick(next) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-left font-bold disabled:cursor-default disabled:opacity-60 ${className}`}
      >
        {chosen?.label}
        <CaretDown size={13} weight="bold" className={`flex-none transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className={`absolute left-0 z-20 max-h-[320px] min-w-[220px] animate-enter overflow-auto border-2 border-ink bg-white text-[14.5px] font-normal tracking-normal text-ink normal-case shadow-[0_14px_30px_rgba(20,17,16,.18)] [font-stretch:100%] ${up ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => pick(option.value)}
              className={`flex w-full flex-col border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-hover ${option.value === value ? "bg-hover shadow-[inset_4px_0_0_var(--color-high)]" : ""}`}
            >
              <b className="font-bold">{option.label}</b>
              {option.note && <small className="text-[12.5px] text-muted">{option.note}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
