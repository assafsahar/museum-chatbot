// app.js (replace fully)
// Comments in English only

import { getEls } from "./modules/dom.js";
import {
  renderMuseum,
  renderHero,
  renderCreator,
  renderDescription,
  renderVideo,
  setTags,
} from "./modules/render.js";
import { createChatClient } from "./modules/chatClient.js";
import { setupVoiceInput } from "./modules/voice.js";

// ------------------------------
// Local Conversation Tracking (Client-Side)
// ------------------------------

const TRACKING = {
  indexKey: "mchat:v1:index",
  sessionPrefix: "mchat:v1:session:",
  maxSessions: 50,
  maxMessagesPerSession: 200,
};

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readIndex() {
  return safeJsonParse(localStorage.getItem(TRACKING.indexKey) || "", []);
}

function writeIndex(list) {
  localStorage.setItem(TRACKING.indexKey, JSON.stringify(list));
}

function saveSession(session) {
  localStorage.setItem(`${TRACKING.sessionPrefix}${session.id}`, JSON.stringify(session));

  const index = readIndex();
  const summary = {
    id: session.id,
    museumId: session.museumId || null,
    exhibitionId: session.exhibitionId || null,
    exhibitId: session.exhibitId,
    exhibitTitle: session.exhibitTitle || "",
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastUserText: (session.messages.filter((m) => m.role === "user").slice(-1)[0]?.text || "").slice(0, 120),
  };

  const next = [summary, ...index.filter((s) => s.id !== session.id)].slice(0, TRACKING.maxSessions);
  writeIndex(next);
}

function startConversationTracking({ museumId, exhibitionId, exhibitId, exhibitTitle }) {
  const session = {
    id: createId(),
    museumId: museumId || null,
    exhibitionId: exhibitionId || null,
    exhibitId,
    exhibitTitle: exhibitTitle || "",
    startedAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
  };

  const api = {
    setExhibitTitle(title) {
      session.exhibitTitle = title || "";
      session.updatedAt = nowIso();
      saveSession(session);
    },
    resetSession() {
      session.id = createId();
      session.startedAt = nowIso();
      session.updatedAt = nowIso();
      session.messages = [];
      saveSession(session);
    },
    syncFromDom(chatLogEl) {
      if (!chatLogEl) return;

      const msgs = Array.from(chatLogEl.querySelectorAll(".msg"));
      const mapped = msgs
        .map((el) => {
          const role = el.classList.contains("user") ? "user" : "assistant";
          const text = (el.querySelector(".bubble")?.textContent || "").trim();
          return { role, text };
        })
        .filter((m) => m.text.length > 0)
        .slice(-TRACKING.maxMessagesPerSession);

      session.messages = mapped.map((m) => ({ ...m, ts: nowIso() }));
      session.updatedAt = nowIso();
      saveSession(session);
    },
  };

  // Initial persist (so the museum page sees the session even if no messages yet)
  saveSession(session);

  return api;
}

// ------------------------------
// Content Resolution
// ------------------------------

function getContentUrl({ museumId, exhibitionId }) {
  // If both exist, load per-tenant file. Otherwise keep legacy behavior.
  if (museumId && exhibitionId) {
    const m = encodeURIComponent(String(museumId).trim());
    const e = encodeURIComponent(String(exhibitionId).trim());
    return `assets/content/${m}/${e}.json`;
  }
  return "assets/exhibits.json";
}

// Load monthly usage counter (optional UI)
async function loadMonthlyUsage({ museumId, exhibitionId }) {
  const el = document.getElementById("usageMonthlyValue");
  if (!el) return;

  try {
    const qs = new URLSearchParams();
    if (museumId) qs.set("museumId", museumId);
    if (exhibitionId) qs.set("exhibitionId", exhibitionId);

    const url = qs.toString()
      ? `/.netlify/functions/usage?${qs.toString()}`
      : "/.netlify/functions/usage";

    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    if (!res.ok) {
      el.textContent = "שגיאה";
      console.log("usage error:", json);
      return;
    }

    const total = Number(json?.questionsTotal ?? 0);
    el.textContent = `${total} שאלות החודש`;
  } catch (e) {
    el.textContent = "שגיאה";
    console.log("usage fetch failed:", e);
  }
}

(async function () {
  const params = new URLSearchParams(location.search);

  // Exhibit id (existing behavior)
  const exhibitId = params.get("id") || "exhibit-01";

  // Tenant params
  const museumId = params.get("museum") || params.get("museumId") || null;
  const exhibitionId = params.get("exhibition") || params.get("exhibitionId") || null;

  const debugMode = params.get("debug") === "1";
  const mockMode = params.get("mock") === "1";

  const els = getEls();

  const chat = createChatClient({
    els,
    exhibitId,
    museumId,
    exhibitionId,
    debugMode,
    mockMode,
  });

  // Start local conversation tracking (so museum page can show chats)
  const tracker = startConversationTracking({
    museumId,
    exhibitionId,
    exhibitId,
    exhibitTitle: "",
  });

  // Observe chat DOM and persist on changes
  let syncTimer = null;
  const scheduleSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => tracker.syncFromDom(els.chatLog), 200);
  };

  if (els.chatLog) {
    const mo = new MutationObserver(scheduleSync);
    mo.observe(els.chatLog, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Wire UI events
  els.sendBtn?.addEventListener("click", chat.onSend);

  // Wrap reset so we also start a fresh tracking session
  els.resetBtn?.addEventListener("click", async () => {
    await chat.onReset();
    tracker.resetSession();
    scheduleSync();
  });

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
    },
  });

  // Load data + render
  const contentUrl = getContentUrl({ museumId, exhibitionId });

  let data = null;
  try {
    const res = await fetch(contentUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`content http ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.log("content load failed:", e);
    chat.appendMessage("assistant", "לא הצלחתי לטעון את תוכן התערוכה.");
    return;
  }

  renderMuseum(els, data);

  const exhibit = data?.exhibits?.[exhibitId];
  if (!exhibit) {
    chat.appendMessage("assistant", "לא מצאתי את המיצג הזה.");
    return;
  }

  els.title.textContent = exhibit.title || "";
  els.subtitle.textContent = exhibit.subtitle || "";

  tracker.setExhibitTitle(exhibit.title || exhibitId);

  renderHero(els, exhibit, data);
  renderCreator(els, exhibit);

  setTags(els, exhibit, async (tagText) => {
    chat.appendMessage("user", tagText);
    const pending = chat.appendMessage("assistant", "רגע…");

    const { answer } = await chat.ask(tagText);

    pending.querySelector(".bubble").textContent = answer;
    chat.scrollToBottom();
  });

  renderDescription(els, exhibit);
  renderVideo(els, exhibit);

  // Load monthly usage counter (if the element exists on this page)
  await loadMonthlyUsage({ museumId, exhibitionId });

  chat.appendMessage(
    "assistant",
    "שלום :) אפשר לשאול אותי שאלות על המיצג, או להשתמש בכפתורים למעלה לקבלת מידע מהיר."
  );
})();
