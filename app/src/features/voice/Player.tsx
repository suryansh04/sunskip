import { SpeakerHigh } from "@phosphor-icons/react";
import { say } from "./speech";

// Plays one message: the audio the API made when there is an audioUrl, the browser's speech when not
export default function Player({ text, language, audioUrl }) {
  return (
    <button type="button" onClick={() => say(text, language, audioUrl)} className="press inline-flex min-h-10 items-center gap-1.5 rounded-[10px] bg-sunken px-3.5 text-[15px] font-[650]">
      <SpeakerHigh size={18} weight="fill" />
      Play
    </button>
  );
}
