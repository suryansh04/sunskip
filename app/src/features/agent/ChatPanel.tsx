import { useEffect, useRef, useState } from "react";
import { ArrowLeft, PaperPlaneRight } from "@phosphor-icons/react";
import { api } from "../../api/client";
import { isLive } from "../../api/live";
import RoundButton from "../../components/RoundButton";
import MicButton from "../voice/MicButton";
import { say } from "../voice/speech";
import ChatMessage from "./ChatMessage";

const SUGGESTIONS = [
  { text: "Which route has the least sun?", lang: "en" },
  { text: "Is my bus stop shaded?", lang: "en" },
  { text: "6 बजे कितनी धूप होगी?", lang: "hi" },
];

// Ask SunSkip (screens 20 to 22): a full-screen chat over POST /agent/chat, with the mic from features/voice.
// Props: tripId (the trip the answers are about, or null), location ({ lat, lng } or null),
// about (one line saying what the answers use), listen (start by listening) and onClose.
export default function ChatPanel({ tripId, location, about, listen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [language, setLanguage] = useState(() => localStorage.getItem("language") || "hi-IN");
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const end = useRef(null);

  useEffect(() => {
    isLive("voice").then(setMicLive);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  function add(message) {
    setMessages((shown) => [...shown, message]);
  }

  function ask(question, seconds = undefined) {
    add({ from: "me", text: question, seconds });
    setText("");
    setThinking(true);
    api
      .post("/agent/chat", { sessionId, message: question, language, location, tripId, speak: true })
      .then((res) => {
        setSessionId(res.data.sessionId);
        add({ from: "agent", ...res.data });
        // A question asked by voice is answered by voice
        if (seconds !== undefined) say(res.data.reply, res.data.replyLanguage, res.data.audioUrl);
      })
      .catch((err) => add({ from: "note", text: err.response ? "SunSkip couldn't answer that right now. Ask again in a moment." : "Can't reach SunSkip. Check your internet connection and ask again." }))
      .finally(() => setThinking(false));
  }

  function switchLanguage() {
    const next = language === "hi-IN" ? "en-IN" : "hi-IN";
    localStorage.setItem("language", next);
    setLanguage(next);
  }

  const typed = text.trim();
  return (
    <section aria-label="Ask SunSkip" className="absolute inset-0 z-40 flex animate-forward flex-col bg-paper">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-1">
        <RoundButton flat label="Back" onClick={onClose}>
          <ArrowLeft size={20} weight="bold" />
        </RoundButton>
        <h1 className="flex-1 text-[22px] leading-[1.2] font-bold [font-stretch:112%]">Ask SunSkip</h1>
        <button type="button" onClick={switchLanguage} aria-label={`Answers in ${language === "hi-IN" ? "Hindi" : "English"}. Tap to change.`} className="press rounded-[10px] bg-white px-[11px] py-[7px] text-[14px] font-[650]">
          <span lang="hi" className={language === "hi-IN" ? "" : "text-muted"}>
            हिंदी
          </span>
          {" · "}
          <span className={language === "en-IN" ? "" : "text-muted"}>English</span>
        </button>
      </div>
      <p className="mx-5 mt-1.5 text-[15px] text-muted">{about}</p>

      {listening ? (
        <div className="absolute inset-x-0 top-[calc(50%+95px)] flex flex-col items-center gap-2.5 px-6 text-center">
          <b className="text-[22px] font-bold">Listening…</b>
          <span className="max-w-[30ch] text-[14px] text-muted">Speak in Hindi or English. Tap the mic when you're done.</span>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pt-[18px]">
            {messages.length === 0 && !thinking && <p className="mx-1 text-[15px] text-muted">Ask about the sun on your trip, a stop's shade, or when to leave. Your questions and the answers will show here.</p>}
            {messages.map((message, i) => (
              <ChatMessage key={i} message={message} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2.5 self-start rounded-2xl rounded-bl-md bg-white px-3.5 py-3 text-[14px] text-muted">
                <span className="inline-flex gap-1">
                  {[0, 150, 300].map((delay) => (
                    <i key={delay} className="size-[7px] animate-dot rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </span>
                Checking your trip's real numbers…
              </div>
            )}
            <span ref={end} />
          </div>
          <div className="flex flex-none gap-2 overflow-x-auto px-4 pt-4 pb-1">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion.text} type="button" lang={suggestion.lang} disabled={thinking} onClick={() => ask(suggestion.text)} className="press min-h-10 flex-none rounded-xl border border-line bg-white px-3.5 text-[14px] font-semibold">
                {suggestion.text}
              </button>
            ))}
          </div>
          <form
            className={`flex items-center gap-2.5 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] ${micLive && !typed ? "pr-[82px]" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (typed && !thinking) ask(typed);
            }}
          >
            <label htmlFor="question" className="sr-only">
              Ask a question
            </label>
            <input
              id="question"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ask in Hindi or English"
              autoComplete="off"
              className="min-h-[52px] min-w-0 flex-1 rounded-[14px] border border-line bg-white px-3.5 text-[16px] text-ink placeholder:text-muted"
            />
            {typed && (
              <button type="submit" aria-label="Send" disabled={thinking} className="press grid size-14 flex-none place-items-center rounded-full bg-ink text-white disabled:opacity-50">
                <PaperPlaneRight size={24} weight="fill" />
              </button>
            )}
          </form>
        </>
      )}

      {/* One mic for both layouts, so a recording survives the switch to the listening screen */}
      {micLive && listening && (
        <span className="pointer-events-none absolute top-1/2 left-1/2 grid size-[150px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink/[.06]">
          <span className="absolute inset-0 animate-listen rounded-full border-[3px] border-ink opacity-25" />
        </span>
      )}
      {micLive && (
        <MicButton
          autoStart={listen}
          onListening={setListening}
          onTranscript={(heard) => ask(heard.transcript, heard.seconds)}
          onError={(message) => add({ from: "note", text: message })}
          className={listening ? "absolute top-1/2 left-1/2 size-[84px] -translate-x-1/2 -translate-y-1/2" : `absolute right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] size-14 ${typed ? "hidden" : ""}`}
        />
      )}
    </section>
  );
}
