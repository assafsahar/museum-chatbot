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
import { createAnalyticsTracker } from "./modules/analyticsClient.js";

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

let ytApiPromise = null;

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {}
      }
      resolve(window.YT || null);
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) return;

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });

  return ytApiPromise;
}

function isYouTubeUrl(url) {
  const s = String(url || "").toLowerCase();
  return s.includes("youtube.com/embed/") || s.includes("youtu.be/");
}

function ensureYouTubeApiParams(url) {
  try {
    const u = new URL(String(url || ""), window.location.origin);
    u.searchParams.set("enablejsapi", "1");
    u.searchParams.set("origin", window.location.origin);
    return u.toString();
  } catch {
    return String(url || "");
  }
}

async function wireYouTubePlayTracking({ iframeEl, url, onFirstPlay }) {
  if (!iframeEl || !isYouTubeUrl(url)) return;

  const apiUrl = ensureYouTubeApiParams(url);
  if (iframeEl.src !== apiUrl) iframeEl.src = apiUrl;

  const YT = await loadYouTubeIframeApi().catch(() => null);
  if (!YT || !YT.Player) return;

  if (!iframeEl.id) {
    iframeEl.id = `yt-frame-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  let fired = false;
  // eslint-disable-next-line no-new
  new YT.Player(iframeEl.id, {
    events: {
      onStateChange: (ev) => {
        if (fired) return;
        if (ev?.data === YT.PlayerState.PLAYING) {
          fired = true;
          onFirstPlay();
        }
      },
    },
  });
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
  const analytics = createAnalyticsTracker({
    museumId,
    exhibitionId,
    exhibitId,
    page: "exhibit",
  });

  const chat = createChatClient({
    els,
    exhibitId,
    museumId,
    exhibitionId,
    debugMode,
    mockMode,
    onAnalyticsEvent: (eventName, meta = {}) => analytics.track(eventName, meta),
  });
  analytics.track("app_open", {
    debugMode: !!debugMode,
    mockMode: !!mockMode,
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
    analytics.track("chat_reset_click", {});
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
    analytics.track("ui_error", { kind: "content_load_failed" });
    chat.appendMessage("assistant", "לא הצלחתי לטעון את תוכן התערוכה.");
    return;
  }

  renderMuseum(els, data);

  const exhibit = data?.exhibits?.[exhibitId];
  if (!exhibit) {
    analytics.track("ui_error", { kind: "exhibit_not_found" });
    chat.appendMessage("assistant", "לא מצאתי את המיצג הזה.");
    return;
  }

  els.title.textContent = exhibit.title || "";
  analytics.track("exhibit_view", { hasVideo: !!String(exhibit.videoUrl || "").trim() });
  els.subtitle.textContent = exhibit.subtitle || "";

  tracker.setExhibitTitle(exhibit.title || exhibitId);

  renderHero(els, exhibit, data);
  renderCreator(els, exhibit);

  setTags(els, exhibit, async (tagText) => {
    analytics.track("quick_question_click", { buttonLabel: String(tagText || "").trim() });
    chat.appendMessage("user", tagText);
    const pending = chat.appendMessage("assistant", "רגע…");

    const { answer, debug, quotaWarning } = await chat.ask(tagText);

    pending.querySelector(".bubble").textContent = answer;
    analytics.track("chat_answer_received", {
      answerMode: debug?.mode || null,
      quotaWarning: !!quotaWarning?.message,
      source: "quick_question",
    });
    chat.scrollToBottom();
  });

  renderDescription(els, exhibit);
  renderVideo(els, exhibit);
  let videoPlayTracked = false;
  const trackVideoPlay = (source) => {
    if (videoPlayTracked) return;
    videoPlayTracked = true;
    analytics.track("video_play_click", { source: source || "unknown" });
  };
  await wireYouTubePlayTracking({
    iframeEl: els.videoFrame,
    url: exhibit.videoUrl,
    onFirstPlay: () => {
      trackVideoPlay("youtube_playing");
    },
  });

  // Load monthly usage counter (if the element exists on this page)
  await loadMonthlyUsage({ museumId, exhibitionId });

  chat.appendMessage(
    "assistant",
    "שלום :) אפשר לשאול אותי שאלות על המיצג, או להשתמש בכפתורים למעלה לקבלת מידע מהיר."
  );
})();
