import { useState } from "react";
import { UserCircle } from "@phosphor-icons/react";
import { demoLogin } from "../auth";

// For judges: one click signs in with the shared demo account (set at build time)
export default function DemoAccount({ next, onSignedIn, onFailed }) {
  const [signingIn, setSigningIn] = useState(false);

  function signIn() {
    setSigningIn(true);
    demoLogin()
      .then(() => onSignedIn(next))
      .catch(onFailed)
      .finally(() => setSigningIn(false));
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={signingIn}
      className="flex min-h-[58px] items-center justify-center gap-2.5 bg-high-text px-7 text-[16.5px] font-bold text-white hover:bg-[#9A3412] disabled:opacity-60"
    >
      <UserCircle size={20} weight="bold" />
      {signingIn ? "Signing in…" : "Sign in as demo user"}
    </button>
  );
}
