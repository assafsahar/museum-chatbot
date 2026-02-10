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
