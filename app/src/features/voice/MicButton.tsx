import { useEffect, useRef, useState } from "react";
import { Microphone } from "@phosphor-icons/react";
import { api } from "../../api/client";

const MAX_CLIP_MS = 30000; // /voice/stt takes clips up to 30 s
const LIMIT_REACHED = 429;

// Tap to talk, tap again when done. Records a clip, sends it to POST /voice/stt and gives back
// { transcript, language, english, seconds }. onListening tells the host when recording starts and stops,
// onError gets a sentence to show. `autoStart` begins listening as soon as the button appears.
export default function MicButton({ onTranscript, onListening, onError, autoStart = false, className = "" }) {
  const [listening, setListening] = useState(false);
  const recorder = useRef(null);
  const clipTimer = useRef(null);
  const closed = useRef(false);
  // The host's newest callbacks: a clip is sent long after it started, and the question must go with the
  // chat's language and conversation as they are then, not as they were when the mic was tapped
  const host = useRef(null);
  host.current = { onTranscript, onListening, onError };

  useEffect(() => {
    closed.current = false;
    if (autoStart) start();
    return () => {
      // Closed mid-question: drop the clip instead of sending it (each one uses a daily voice call)
      closed.current = true;
      clearTimeout(clipTimer.current);
      if (!recorder.current) return;
      recorder.current.onstop = null;
      recorder.current.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function start() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return host.current.onError("This browser can't record. Type your question instead.");
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // Allowed only after the chat was closed: let go of the mic straight away
        if (closed.current) return stream.getTracks().forEach((track) => track.stop());
        // Chrome and Android record webm, iPhone Safari mp4; the API takes both
        const type = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
        const clip = [];
        const startedAt = Date.now();
        recorder.current = new MediaRecorder(stream, { mimeType: type });
        recorder.current.ondataavailable = (event) => clip.push(event.data);
        recorder.current.onstop = () => {
          clearTimeout(clipTimer.current);
          stream.getTracks().forEach((track) => track.stop());
          send(new Blob(clip, { type }), Math.round((Date.now() - startedAt) / 1000));
        };
        recorder.current.start();
        clipTimer.current = setTimeout(stop, MAX_CLIP_MS);
        setListening(true);
        host.current.onListening(true);
      })
      .catch(() => host.current.onError("The microphone isn't available. Allow it for this site, or type your question."));
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function send(audio, seconds) {
    const form = new FormData();
    form.append("audio", audio, audio.type === "audio/webm" ? "question.webm" : "question.mp4");
    api
      .post("/voice/stt", form)
      .then((res) => {
        if (closed.current) return; // the chat was closed while the clip was being heard: ask nothing
        // Silence (or noise) comes back as an empty transcript: there is no question to send
        if (res.data.transcript.trim()) host.current.onTranscript({ ...res.data, seconds });
        else host.current.onError("SunSkip didn't hear a question. Tap the mic and try again, or type it.");
      })
      .catch((err) => host.current.onError(err.response?.status === LIMIT_REACHED ? "Voice questions are used up for today. Type your question instead." : "SunSkip couldn't hear that. Try again, or type your question."))
      .finally(() => {
        setListening(false);
        host.current.onListening(false);
      });
  }

  return (
    <button
      type="button"
      aria-label={listening ? "Stop listening" : "Talk"}
      onClick={listening ? stop : start}
      className={`press grid flex-none place-items-center rounded-full bg-ink text-white ${className}`}
    >
      <Microphone size={listening ? 36 : 24} weight="fill" />
    </button>
  );
}
