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

function normId(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

function makeCacheKey({ museumId, exhibitionId, exhibitId, question }) {
  const m = normId(museumId) || "";
  const e = normId(exhibitionId) || "";
  const x = normId(exhibitId) || "";
  return `${m}||${e}||${x}||${normalizeQuestion(question)}`;
}

function supportsTTS() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function createChatClient({
  els,
  exhibitId,
  museumId = null,
  exhibitionId = null,
  debugMode,
  mockMode,
}) {
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

  function formatServerError(json) {
    // Prefer server-provided details to make debugging easy
    const details = String(json?.details || "").trim();
    const error = String(json?.error || "").trim();

    if (details) return `שגיאה: ${details}`;
    if (error) return `שגיאה: ${error}`;
    return "שגיאת רשת. נסה/י שוב.";
  }

  async function ask(question) {
    const qNorm = normalizeQuestion(question);

    const key = makeCacheKey({
      museumId,
      exhibitionId,
      exhibitId,
      question: qNorm,
    });

    const cached = cacheGet(key);
    if (cached) return { answer: cached, debug: { clientCache: true } };

    if (mockMode) {
      const answer = `מצב הדגמה: "${qNorm}"`;
      cacheSet(key, answer);
      return { answer, debug: { mock: true } };
    }

    const url = debugMode ? "/.netlify/functions/chat?debug=1" : "/.netlify/functions/chat";

    const payload = {
      exhibitId: normId(exhibitId),
      museumId: normId(museumId),
      exhibitionId: normId(exhibitionId),
      question: qNorm,
      baseUrl: window.location.origin, // CHANGE: make localhost/prod fetch reliable
    };

    let res;
    let json;

    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      json = await res.json().catch(() => null);
    } catch {
      return { answer: "שגיאת רשת. נסה/י שוב.", debug: null };
    }

    if (!res.ok || !json) {
      // CHANGE: show server error details when available
      return { answer: formatServerError(json), debug: json?.debug || null };
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
