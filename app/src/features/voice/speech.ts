// One voice at a time. Plays the audio the API made (Sarvam, endpoint 10 and 11); when there is
// no audioUrl, or it won't play, the browser's own speech reads the text instead (TRD §6).

let playing = null;

function speakInBrowser(text, language) {
  if (!window.speechSynthesis) return;
  const words = new SpeechSynthesisUtterance(text);
  words.lang = language;
  window.speechSynthesis.speak(words);
}

export function say(text, language, audioUrl) {
  hush();
  if (!audioUrl) return speakInBrowser(text, language);
  const audio = new Audio(audioUrl);
  playing = audio;
  // Careful: hush() before the audio starts also rejects play(); that clip was stopped on purpose, so don't read it out
  audio.play().catch(() => playing === audio && speakInBrowser(text, language));
}

export function hush() {
  if (playing) playing.pause();
  playing = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}
