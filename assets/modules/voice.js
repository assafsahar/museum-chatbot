// assets/voice.js
// Comments in English only

export function setupVoiceInput({ micBtn, q, onRecognizedText }) {
  if (!micBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.style.display = "none";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "he-IL";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let isRecording = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
  };

  recognition.onerror = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
  };

  recognition.onresult = async (event) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim();
    if (!text) return;

    if (q) q.value = text;
    await onRecognizedText(text);
  };

  micBtn.addEventListener("click", () => {
    if (isRecording) {
      recognition.stop();
      return;
    }

    if (q) q.value = "";
    recognition.start();
  });
}

// ===== TTS (Text-to-Speech) =====

let currentUtterance = null;

function hasTts() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function getVoicesSafe() {
  if (!hasTts()) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

function pickHebrewVoice() {
  const voices = getVoicesSafe();
  return voices.find((v) => String(v.lang || "").toLowerCase().startsWith("he")) || null;
}

export function initTTS() {
  if (!hasTts()) return;

  // Prime voices list (some browsers load voices async)
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

export function stopSpeaking() {
  if (!hasTts()) return;
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function speakText(text) {
  if (!hasTts()) return false;

  stopSpeaking();

  const cleaned = String(text || "").trim();
  if (!cleaned) return false;

  const u = new SpeechSynthesisUtterance(cleaned);
  u.lang = "he-IL";

  const v = pickHebrewVoice();
  if (v) u.voice = v;

  u.rate = 1.0;
  u.pitch = 1.0;

  currentUtterance = u;
  window.speechSynthesis.speak(u);

  return true;
}
