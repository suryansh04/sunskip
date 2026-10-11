import { useState } from "react";
import { SpeakerHigh } from "@phosphor-icons/react";
import { api } from "../../api/client";
import { say } from "./speech";

const TTS_MAX_CHARS = 500; // /voice/tts takes at most this much text

// Plays one message: the audio the API made when there is an audioUrl, else SunSkip's voice asked for on tap
// (POST /voice/tts, kept once made), and the browser's own speech if that fails
export default function Player({ text, language, audioUrl }) {
  const [url, setUrl] = useState(audioUrl);
  const [loading, setLoading] = useState(false);

  function play() {
    if (url || text.length > TTS_MAX_CHARS) return say(text, language, url);
    setLoading(true);
    api
      .post("/voice/tts", { text, language })
      .then((res) => {
        setUrl(res.data.audioUrl);
        say(text, language, res.data.audioUrl);
      })
      .catch(() => say(text, language, null))
      .finally(() => setLoading(false));
  }

  return (
    <button type="button" onClick={play} disabled={loading} className="press inline-flex min-h-10 items-center gap-1.5 rounded-[10px] bg-sunken px-3.5 text-[15px] font-[650] disabled:opacity-60">
      <SpeakerHigh size={18} weight="fill" />
      {loading ? "Loading…" : "Play"}
    </button>
  );
}
