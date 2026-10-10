import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { WarningCircle } from "@phosphor-icons/react";
import { finishLogin, login } from "../auth";
import StateMessage from "../components/StateMessage";

// Cognito sends people back here with a one-time code; swap it for tokens and go where they were headed
export default function Callback() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    finishLogin()
      .then((next) => navigate(next, { replace: true }))
      .catch(() => setFailed(true));
  }, []);

  if (!failed) return <p className="p-10 text-muted">Signing you in…</p>;
  return (
    <StateMessage icon={<WarningCircle size={40} weight="bold" />} title="Sign-in didn't finish" text="The sign-in link was used already or has run out. Sign in again to open the portal.">
      <button type="button" onClick={() => login("/")} className="min-h-[46px] bg-ink px-5 font-bold text-white">
        Sign in again
      </button>
    </StateMessage>
  );
}
