import { Waveform } from "@phosphor-icons/react";
import Player from "../voice/Player";

// What the agent checked, in the user's words (api.md endpoint 9, toolsUsed)
const CHECKED = { plan_route: "the routes", find_best_time: "best time to leave", get_conditions: "heat and air", explain_segment: "this part of the trip" };

// One chat bubble. `message.from` is "me", "agent" or "note" (something went wrong, said plainly).
export default function ChatMessage({ message }) {
  if (message.from === "me") {
    return (
      <div className="max-w-[86%] self-end rounded-2xl rounded-br-md bg-ink px-3.5 py-3 text-[16px] text-white">
        {message.seconds !== undefined && (
          <span className="mb-1 flex items-center gap-1.5 text-[13px] text-[#D9CFC5]">
            <Waveform size={16} weight="bold" />
            {`Voice · 0:${String(message.seconds).padStart(2, "0")}`}
          </span>
        )}
        <p>{message.text}</p>
      </div>
    );
  }
  if (message.from === "note") return <p className="max-w-[86%] self-start rounded-2xl rounded-bl-md bg-alert-tint px-3.5 py-3 text-[15px] text-alert">{message.text}</p>;

  const inHindi = message.replyLanguage === "hi-IN";
  const checked = message.toolsUsed.map((tool) => CHECKED[tool]).filter(Boolean).join(", ");
  return (
    <div className="max-w-[86%] self-start rounded-2xl rounded-bl-md bg-white px-3.5 py-3 text-[16px]">
      <p lang={inHindi ? "hi" : "en"} className={inHindi ? "text-[17px]" : ""}>
        {message.reply}
      </p>
      {inHindi && message.englishReply && <p className="mt-1.5 text-[14px] text-muted">{message.englishReply}</p>}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <Player text={message.reply} language={message.replyLanguage} audioUrl={message.audioUrl} />
        {message.fallback ? <span className="text-[13px] font-semibold text-muted">Short answer from your trip's numbers</span> : checked && <span className="text-[13px] font-semibold text-shade-text">{`Checked: ${checked}`}</span>}
      </div>
    </div>
  );
}
