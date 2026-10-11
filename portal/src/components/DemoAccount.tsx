import { useState } from "react";
import { Copy, Check, UserCircle } from "@phosphor-icons/react";
import { DEMO, demoLogin } from "../auth";

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard
      .writeText(value)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }
  return (
    <div className="flex items-center justify-between gap-3 border-b border-barline py-2.5 last:border-b-0">
      <span className="text-[13px] text-bartext">{label}</span>
      <span className="flex items-center gap-2">
        <b className="font-mono text-[14.5px] font-semibold text-white select-all">{value}</b>
        <button type="button" aria-label={`Copy the ${label.toLowerCase()}`} onClick={copy} className="grid size-8 place-items-center text-bartext hover:text-white">
          {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
        </button>
      </span>
    </div>
  );
}

// For judges: the shared demo account, shown in full, and one click to sign in with it
export default function DemoAccount({ next, onSignedIn }) {
  const [signingIn, setSigningIn] = useState(false);
  const [failed, setFailed] = useState(false);

  function signIn() {
    setSigningIn(true);
    setFailed(false);
    demoLogin()
      .then(() => onSignedIn(next))
      .catch(() => setFailed(true))
      .finally(() => setSigningIn(false));
  }

  return (
    <div className="mt-6 max-w-[420px] border border-barline px-4 pt-3 pb-4">
      <p className="flex items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-high uppercase">
        <UserCircle size={18} weight="bold" />
        Demo account for judges
      </p>
      <div className="mt-1.5">
        <CopyRow label="Email" value={DEMO.email} />
        <CopyRow label="Password" value={DEMO.password} />
      </div>
      <button
        type="button"
        onClick={signIn}
        disabled={signingIn}
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 bg-high-text text-[15.5px] font-bold text-white hover:bg-[#9A3412] disabled:opacity-60"
      >
        {signingIn ? "Signing in…" : "Sign in as demo"}
      </button>
      {failed && <p className="mt-2 text-[13px] text-[#F5A3A3]">The demo sign-in didn't work. Use the email and password above with the city sign-in.</p>}
    </div>
  );
}
