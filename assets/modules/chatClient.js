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

function isProbablyLocalStaticServer() {
  // Comments in English only
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

function joinUrl(base, path) {
  // Comments in English only
  const b = String(base || "").trim();
  const p = String(path || "").trim();

  if (!b) return p; // relative
  return `${b.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

async function safeReadJson(res) {
  // Comments in English only
  const ct = String(res.headers?.get?.("content-type") || "");
  if (!ct.includes("application/json")) return null;
  return res.json().catch(() => null);
}

export function createChatClient({
  els,
  exhibitId,
  museumId = null,
  exhibitionId = null,
  debugMode = false,
  mockMode = false,

  // Optional: use this to call production Functions while running locally
  // Example: "https://museum-chatbot1.netlify.app"
  functionsBaseUrl = "",
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

  function buildChatUrl() {
    // Comments in English only
    const basePath = "/.netlify/functions/chat";
    const full = joinUrl(functionsBaseUrl, basePath);
    return debugMode ? `${full}?debug=1` : full;
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

    const url = buildChatUrl();

    const payload = {
      exhibitId: normId(exhibitId),
      museumId: normId(museumId),
      exhibitionId: normId(exhibitionId),
      question: qNorm,

      // You can uncomment this if you want the Function to always know baseUrl explicitly
      // baseUrl: typeof window !== "undefined" ? window.location.origin : "",
    };

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { answer: "שגיאת רשת. נסה/י שוב.", debug: { fetchError: String(e?.message || e) } };
    }

    // If you're on localhost with a static server (not netlify dev), this usually returns 404/405
    if ((res.status === 404 || res.status === 405) && isProbablyLocalStaticServer() && !functionsBaseUrl) {
      return {
        answer: "נראה שה־Functions לא רצים לוקלית. להרצה מקומית השתמש/י ב־netlify dev, או הגדר/י functionsBaseUrl ל־Production.",
        debug: { status: res.status, url },
      };
    }

    const json = await safeReadJson(res);

    if (!res.ok || !json) {
      const text = await res.text().catch(() => "");
      return {
        answer: "שגיאת שרת. נסה/י שוב.",
        debug: {
          status: res.status,
          url,
          responseTextPreview: String(text || "").slice(0, 300),
        },
      };
    }

    const answer = json.answer || "שגיאת שרת. נסה/י שוב.";
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
