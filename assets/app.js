import { getEls } from "./modules/dom.js";
import { renderMuseum, renderHero, renderCreator, renderDescription, renderVideo, setTags } from "./modules/render.js";
import { createChatClient } from "./modules/chatClient.js";
import { setupVoiceInput } from "./modules/voice.js";

(async function () {
  const params = new URLSearchParams(location.search);
  const exhibitId = params.get("id") || "exhibit-01";
  const debugMode = params.get("debug") === "1";
  const mockMode = params.get("mock") === "1";

  const els = getEls();

  const chat = createChatClient({
    els,
    exhibitId,
    debugMode,
    mockMode,
  });

  // Wire UI events
  els.sendBtn?.addEventListener("click", chat.onSend);
  els.resetBtn?.addEventListener("click", chat.onReset);

  els.q?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.onSend();
    }
  });

  setupVoiceInput({
    micBtn: els.micBtn,
    q: els.q,
    onRecognizedText: async (text) => {
      els.q.value = text;
      await chat.onSend();
    }
  });

  // Load data + render
  const res = await fetch("assets/exhibits.json", { cache: "no-store" });
  const data = await res.json();

  renderMuseum(els, data);

  const exhibit = data?.exhibits?.[exhibitId];
  if (!exhibit) {
    chat.appendMessage("assistant", "לא מצאתי את המיצג הזה.");
    return;
  }

  els.title.textContent = exhibit.title || "";
  els.subtitle.textContent = exhibit.subtitle || "";

  renderHero(els, exhibit, data);
  renderCreator(els, exhibit);
  setTags(els, exhibit, async (tagText) => {
    // Buttons send as natural language to chat
    chat.appendMessage("user", tagText);
    const pending = chat.appendMessage("assistant", "רגע…");

    const { answer } = await chat.ask(tagText);

    pending.querySelector(".bubble").textContent = answer;
    chat.scrollToBottom();
  });

  renderDescription(els, exhibit);
  renderVideo(els, exhibit);

  chat.appendMessage(
    "assistant",
    "שלום 🙂 אפשר לשאול אותי שאלות על המיצג, או להשתמש בכפתורים למעלה לקבלת מידע מהיר."
  );
})();
