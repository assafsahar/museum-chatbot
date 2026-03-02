// assets/modules/analyticsClient.js
// Comments in English only

const SESSION_KEY = "mchat:v1:analytics:session_id";

function createSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = createSessionId();
    localStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return createSessionId();
  }
}

function joinUrl(base, path) {
  const b = String(base || "").trim();
  const p = String(path || "").trim();
  if (!b) return p;
  return `${b.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

export function createAnalyticsTracker({
  museumId = null,
  exhibitionId = null,
  exhibitId = null,
  page = "exhibit",
  functionsBaseUrl = "",
}) {
  const sessionId = getOrCreateSessionId();
  const endpoint = joinUrl(functionsBaseUrl, "/.netlify/functions/analytics");

  async function track(eventName, meta = {}) {
    try {
      const payload = {
        eventName: String(eventName || "").trim(),
        museumId: museumId || null,
        exhibitionId: exhibitionId || null,
        exhibitId: exhibitId || null,
        sessionId,
        page,
        meta: meta && typeof meta === "object" ? meta : {},
      };

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // Analytics must not break UX
    }
  }

  return {
    sessionId,
    track,
  };
}
