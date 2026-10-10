import { useEffect, useRef } from "react";

// The white bottom sheet over the map. With onClose it is a dialog: a dim layer behind it closes it.
export default function Sheet({ children, label, className = "", onResize = null, onClose = null }) {
  const box = useRef(null);

  useEffect(() => {
    if (!onResize) return;
    const observer = new ResizeObserver(() => onResize(box.current.offsetHeight));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <>
      {onClose && <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 z-20 animate-fade cursor-default bg-ink/35" />}
      <section
        ref={box}
        aria-label={label}
        role={onClose ? "dialog" : undefined}
        className={`absolute inset-x-0 bottom-0 animate-up rounded-t-[22px] bg-sheet shadow-[0_-6px_24px_rgba(40,25,10,.10)] ${onClose ? "z-30" : ""} ${className}`}
      >
        <div className="mx-auto mt-2 h-[5px] w-[38px] rounded-[3px] bg-line" />
        {children}
      </section>
    </>
  );
}
