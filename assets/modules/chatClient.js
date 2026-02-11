// assets/chatClient.js
// Comments in English only

import { scrollChatLogToBottom, ensureInputVisibleOnMobile } from "./dom.js";
import { initTTS, speakText, stopSpeaking } from "./voice.js";

const CLIENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function nowMs() {
  return Date.now();
}

function normalizeQuestion(q) {
  return String(q || "")
    .trim()
    .replace(/\u05F3/g, "'")
    .replace(/\s+/g, " ");
}

function makeCacheKey(exhibitId, question) {
  return `${String(exhibitId || "").trim()}||${normalizeQuestion(question)}`;
}

function supportsTTS() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function createChatClient({ els, exhibitId, debugMode, mockMode }) {
  const clientCache = new Map(); // key -> { answer, ts }

  // Init TTS once per page
  initTTS();

  function cacheGet(key) {
    const v = clientCache.get(key);
    if (!v) return null;
    if (nowMs() - v.ts > CLIENT_CACHE_TTL_MS) {
      clientCache.delete(key);
      return null;
    }
    return v.answer;
  }

  function cacheSet(key, answer) {
    clientCache.set(key, { answer, ts: nowMs() });
  }

  function addTtsControls(rowEl, text) {
    if (!supportsTTS()) return;

    const controls = document.createElement("div");
    controls.className = "ttsControls";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "ttsBtn";
    playBtn.textContent = "השמע";

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "ttsBtn ttsBtn--ghost";
    stopBtn.textContent = "עצור";

    playBtn.addEventListener("click", () => {
      speakText(text);
    });

    stopBtn.addEventListener("click", () => {
      stopSpeaking();
    });

    controls.appendChild(playBtn);
    controls.appendChild(stopBtn);

    rowEl.appendChild(controls);
  }

  function appendMessage(role, text) {
    const row = document.createElement("div");
    row.className = `msg ${role}`;

    const label = document.createElement("div");
    label.className = "msgLabel";
    label.textContent = role === "user" ? "מבקר" : "מדריך";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = String(text || "");

    row.appendChild(label);
    row.appendChild(bubble);

    // Add TTS controls only for assistant messages
    if (role === "assistant") {
      addTtsControls(row, String(text || ""));
    }

    els.chatLog.appendChild(row);

    scrollToBottom();
    ensureInputVisibleOnMobile(els.q);

    return row;
  }

  function scrollToBottom() {
    scrollChatLogToBottom(els.chatLog);
  }

  async function ask(question) {
    const qNorm = normalizeQuestion(question);
    const key = makeCacheKey(exhibitId, qNorm);

    const cached = cacheGet(key);
    if (cached) return { answer: cached, debug: { clientCache: true } };

    if (mockMode) {
      const answer = `מצב הדגמה: "${qNorm}"`;
      cacheSet(key, answer);
      return { answer, debug: { mock: true } };
    }

    const url = debugMode
      ? "/.netlify/functions/chat?debug=1"
      : "/.netlify/functions/chat";

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exhibitId, question: qNorm }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json) {
      return { answer: "שגיאת רשת. נסה/י שוב.", debug: null };
    }

    const answer = json.answer || "שגיאת רשת. נסה/י שוב.";
    cacheSet(key, answer);

    return { answer, debug: json.debug || null };
  }

  async function onSend() {
    const q = (els.q.value || "").trim();
    if (!q) return;

    els.q.value = "";
    appendMessage("user", q);

    const pending = appendMessage("assistant", "רגע…");
    const { answer } = await ask(q);

    const bubble = pending.querySelector(".bubble");
    if (bubble) bubble.textContent = answer;

    // Update TTS handlers to speak the final answer (replace controls)
    const oldControls = pending.querySelector(".ttsControls");
    if (oldControls) oldControls.remove();
    addTtsControls(pending, answer);

    scrollToBottom();
    ensureInputVisibleOnMobile(els.q);
  }

  function onReset() {
    stopSpeaking();
    els.chatLog.innerHTML = "";
    appendMessage("assistant", "איפסתי 🙂 אפשר לשאול שוב, או להשתמש בכפתורים למעלה.");
  }

  return {
    appendMessage,
    ask,
    onSend,
    onReset,
    scrollToBottom,
  };
}
