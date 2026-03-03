// assets/modules/gaTelemetry.js
// Comments in English only

function hasGtag() {
  return typeof window !== "undefined" && typeof window.gtag === "function";
}

function truncate(value, maxLen = 180) {
  const s = String(value || "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function cleanParams(params) {
  const out = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (typeof v === "number" && !Number.isFinite(v)) return;
    out[k] = v;
  });
  return out;
}

function withCtx(ctx, extra) {
  return cleanParams({
    page: ctx?.page || null,
    museum_id: ctx?.museumId || null,
    exhibition_id: ctx?.exhibitionId || null,
    exhibit_id: ctx?.exhibitId || null,
    ...extra,
  });
}

export function trackGaEvent(eventName, params = {}) {
  if (!hasGtag()) return;
  try {
    window.gtag("event", eventName, cleanParams(params));
  } catch {}
}

export function trackGaError(ctx, kind, details = {}) {
  trackGaEvent(
    "client_error",
    withCtx(ctx, {
      error_kind: kind,
      ...details,
    })
  );
}

export function initGaReliability(ctx = {}) {
  if (typeof window === "undefined") return;

  // JS runtime errors
  window.addEventListener(
    "error",
    (ev) => {
      trackGaError(ctx, "js_error", {
        message: truncate(ev?.message || "unknown_error"),
        source: truncate(ev?.filename || "unknown_file", 120),
        line: Number(ev?.lineno || 0),
        column: Number(ev?.colno || 0),
      });
    },
    true
  );

  // Unhandled promise errors
  window.addEventListener("unhandledrejection", (ev) => {
    const reason =
      typeof ev?.reason === "string"
        ? ev.reason
        : ev?.reason?.message || JSON.stringify(ev?.reason || "unhandled_rejection");

    trackGaError(ctx, "unhandled_rejection", {
      message: truncate(reason),
    });
  });

  // Basic page load metric
  window.addEventListener("load", () => {
    const nav = performance.getEntriesByType("navigation")?.[0];
    if (nav && Number.isFinite(nav.duration)) {
      trackGaEvent(
        "client_perf",
        withCtx(ctx, {
          metric: "page_load_ms",
          value: Math.round(nav.duration),
        })
      );
    }
  });

  // LCP
  if (typeof PerformanceObserver !== "undefined") {
    try {
      let lcp = 0;
      const po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last?.startTime) lcp = Math.round(last.startTime);
      });
      po.observe({ type: "largest-contentful-paint", buffered: true });

      const flushLcp = () => {
        if (lcp > 0) {
          trackGaEvent(
            "client_perf",
            withCtx(ctx, {
              metric: "lcp_ms",
              value: lcp,
            })
          );
        }
      };

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushLcp();
      });
      window.addEventListener("pagehide", flushLcp);
    } catch {}
  }
}

