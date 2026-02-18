// netlify/functions/chat.js
// Comments in English only

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const OPENAI_INPUT_USD_PER_1M = Number(process.env.OPENAI_INPUT_USD_PER_1M || 0.25);
const OPENAI_OUTPUT_USD_PER_1M = Number(process.env.OPENAI_OUTPUT_USD_PER_1M || 1.0);
const APP_ENV = String(process.env.APP_ENV || "production").trim() || "production";
const NETLIFY_CONTEXT = String(process.env.CONTEXT || "").trim() || "unknown";
const ALLOW_USAGE_WRITE = String(process.env.ALLOW_USAGE_WRITE || "").trim().toLowerCase() === "true";

const EXHIBITS_TTL_MS = 60 * 1000; // 1 minute
const ANSWER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_CACHE_ITEMS = 500;

let exhibitsCache = { key: null, fetchedAt: 0, data: null };
const answerCache = new Map();

function nowMs() {
  return Date.now();
}

function getMonthKeyUtc() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function estimateOpenAiCostUsd({ inputTokens, outputTokens }) {
  const inCost = (Number(inputTokens || 0) / 1_000_000) * OPENAI_INPUT_USD_PER_1M;
  const outCost = (Number(outputTokens || 0) / 1_000_000) * OPENAI_OUTPUT_USD_PER_1M;
  const total = inCost + outCost;
  return Number.isFinite(total) ? total : 0;
}

function getCorsHeaders(event) {
  // Comments in English only
  const h = event.headers || {};
  const origin = String(h.origin || "").trim();
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(event, statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...getCorsHeaders(event),
    },
    body: JSON.stringify(payload),
  };
}

function normalizeQuestion(q) {
  return String(q || "")
    .trim()
    .replace(/\u05F3/g, "'")
    .replace(/\s+/g, " ");
}

function cacheGet(key) {
  const v = answerCache.get(key);
  if (!v) return null;

  if (nowMs() - v.ts > ANSWER_TTL_MS) {
    answerCache.delete(key);
    return null;
  }
  return v.answer;
}

function cacheSet(key, answer) {
  if (answerCache.size >= MAX_CACHE_ITEMS) {
    const firstKey = answerCache.keys().next().value;
    if (firstKey) answerCache.delete(firstKey);
  }
  answerCache.set(key, { answer, ts: nowMs() });
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limitChars(text, maxChars) {
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trim() + "…";
}

function extractText(openaiJson) {
  if (typeof openaiJson?.output_text === "string") return openaiJson.output_text;

  const out = openaiJson?.output || [];
  for (const item of out) {
    const content = item?.content || [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c.text === "string") return c.text;
      if (typeof c?.text === "string") return c.text;
    }
  }
  return "";
}

function getUsageFromOpenAiResponse(openaiJson) {
  const usage = openaiJson?.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens || 0);
  return { inputTokens, outputTokens, totalTokens };
}

function getFactAnswer(exhibit, factKey) {
  const facts = Array.isArray(exhibit?.facts) ? exhibit.facts : [];
  const key = String(factKey || "").trim();

  const found = facts.find((f) => String(f).trim().startsWith(`${key}:`));
  if (!found) return "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";
  return String(found).trim();
}

function isCreatorQuestion(q) {
  const s = String(q || "").trim();
  if (!s) return false;

  const normalized = s.replace(/\u05F3/g, "'").replace(/\s+/g, " ");

  const patterns = [
    /מי\s+היוצר(?:\/ת)?/i,
    /מי\s+היוצרת/i,
    /מי\s+היוצרים/i,
    /ספר(?:\/י)?\s+לי\s+על\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)/i,
    /על\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)/i,
    /אודות\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)/i,
    /ביוגרפ/i,
  ];

  return patterns.some((p) => p.test(normalized));
}

function buildCreatorAnswer(creatorName, creatorBio) {
  const name = creatorName || "היוצר/ת";

  if (!creatorBio) {
    return `היוצר/ת של המיצג הוא/היא ${name}. אין לי מידע ביוגרפי נוסף מתוך המידע שיש לי.`;
  }

  const bio = limitChars(creatorBio, 450);
  const suffix = "מעבר לזה אין לי מידע ביוגרפי נוסף מתוך המידע שיש לי.";
  const sep = /[.!?״”"]\s*$/.test(bio) ? " " : ". ";

  return `${bio}${sep}${suffix}`;
}

function mapPlainButtonToCommand(qNorm) {
  if (qNorm === "תקציר קצר") return "__SUMMARY__";
  if (qNorm === "טכניקות") return "__FACT:טכניקות__";
  if (qNorm === "חומרים") return "__FACT:חומרים__";
  if (qNorm === "שנת יצירה") return "__FACT:שנת יצירה__";
  if (qNorm === "אוצר/ת") return "__FACT:אוצר/ת__";
  return qNorm;
}

function resolveBaseUrl(event, body) {
  // Comments in English only

  const fromBody = String(body?.baseUrl || "").trim();
  if (fromBody) return fromBody;

  const h = event.headers || {};
  const origin = String(h.origin || "").trim();
  if (origin) return origin;

  const referer = String(h.referer || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {}
  }

  const host = String(h["x-forwarded-host"] || h.host || "").trim();
  const proto = String(h["x-forwarded-proto"] || "http").trim();
  if (host) return `${proto}://${host}`;

  return "";
}

function buildContentPath({ museumId, exhibitionId }) {
  if (museumId && exhibitionId) {
    const m = encodeURIComponent(String(museumId).trim());
    const e = encodeURIComponent(String(exhibitionId).trim());
    return `/assets/content/${m}/${e}.json`;
  }
  return "/assets/exhibits.json";
}

async function getExhibitsData({ baseUrl, museumId, exhibitionId }) {
  const path = buildContentPath({ museumId, exhibitionId });
  const cacheKey = `${baseUrl}||${path}`;

  if (exhibitsCache.data && exhibitsCache.key === cacheKey && nowMs() - exhibitsCache.fetchedAt < EXHIBITS_TTL_MS) {
    return exhibitsCache.data;
  }

  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Content fetch failed: ${res.status} ${res.statusText} | ${url} | ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  exhibitsCache = { key: cacheKey, fetchedAt: nowMs(), data };
  return data;
}

async function trackUsage({
  museumId,
  monthKey,
  exhibitId,
  exhibitionId,
  mode,
  cached,
  inputTokens,
  outputTokens,
  totalTokens,
  openaiCostUsd,
  fnMs,
}) {
  if (!ALLOW_USAGE_WRITE) return { ok: false, reason: "usage_write_disabled" };
  if (!supabase) return { ok: false, reason: "supabase_not_configured" };

  const payload = {
    p_museum_id: museumId,
    p_month_key: monthKey,
    p_exhibit_id: exhibitId || null,
    p_exhibition_id: exhibitionId || "default_exhibition",
    p_mode: mode || "openai",
    p_input_tokens: Number(inputTokens || 0),
    p_output_tokens: Number(outputTokens || 0),
    p_total_tokens: Number(totalTokens || 0),
    p_openai_cost_usd: Number(openaiCostUsd || 0),
    p_fn_ms: Number(fnMs || 0),
    p_cached: !!cached,
  };

  const { error } = await supabase.rpc("usage_increment", payload);
  if (error) {
    console.log("usage_increment error:", error);
    return { ok: false, reason: "rpc_error", error: error.message };
  }
  return { ok: true };
}

async function resolveMuseumAndExhibition({ museumId, exhibitionId }) {
  // Comments in English only

  const museumKey = String(museumId || "").trim();
  const exhibitionKey = String(exhibitionId || "").trim();

  // Local/demo mode: accept keys as slugs
  if (!supabase) {
    return {
      museumDbId: museumKey || "default_museum",
      exhibitionDbId: exhibitionKey || "default_exhibition",
      museumSlug: museumKey || "default_museum",
      exhibitionSlug: exhibitionKey || "default_exhibition",
      enforced: false,
    };
  }

  if (!museumKey) throw new Error("Missing museumId");

  // 1) Resolve museum by museum_id OR museum_name
  let museumRow = null;

  {
    const { data, error } = await supabase
      .from("museums")
      .select("museum_id, museum_name")
      .eq("museum_id", museumKey)
      .maybeSingle();

    if (error) throw new Error(`Supabase museums lookup failed: ${error.message}`);
    if (data) museumRow = data;
  }

  if (!museumRow) {
    const { data, error } = await supabase
      .from("museums")
      .select("museum_id, museum_name")
      .eq("museum_name", museumKey)
      .maybeSingle();

    if (error) throw new Error(`Supabase museums lookup failed: ${error.message}`);
    if (data) museumRow = data;
  }

  if (!museumRow) throw new Error("Invalid museumId");

  const museumDbId = museumRow.museum_id;
  const museumSlug = museumRow.museum_name;

  // 2) Resolve exhibition by exhibition_id OR exhibition_name (scoped to museum)
  if (!exhibitionKey) {
    return {
      museumDbId,
      exhibitionDbId: "default_exhibition",
      museumSlug,
      exhibitionSlug: "default_exhibition",
      enforced: true,
    };
  }

  let exhibitionRow = null;

  {
    const { data, error } = await supabase
      .from("exhibitions")
      .select("exhibition_id, exhibition_name, museum_id")
      .eq("exhibition_id", exhibitionKey)
      .eq("museum_id", museumDbId)
      .maybeSingle();

    if (error) throw new Error(`Supabase exhibitions lookup failed: ${error.message}`);
    if (data) exhibitionRow = data;
  }

  if (!exhibitionRow) {
    const { data, error } = await supabase
      .from("exhibitions")
      .select("exhibition_id, exhibition_name, museum_id")
      .eq("exhibition_name", exhibitionKey)
      .eq("museum_id", museumDbId)
      .maybeSingle();

    if (error) throw new Error(`Supabase exhibitions lookup failed: ${error.message}`);
    if (data) exhibitionRow = data;
  }

  if (!exhibitionRow) throw new Error("Invalid exhibitionId for this museumId");

  return {
    museumDbId,
    exhibitionDbId: exhibitionRow.exhibition_id,
    museumSlug,
    exhibitionSlug: exhibitionRow.exhibition_name,
    enforced: true,
  };
}

function buildDemoAnswer({ exhibit, qNorm, qNormRaw }) {
  // Comments in English only

  if (qNorm === "__SUMMARY__") {
    const fullDesc = stripHtml(exhibit.exhibitDescriptionHtml || "");
    return limitChars(fullDesc, 700) || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";
  }

  if (qNorm.startsWith("__FACT:") && qNorm.endsWith("__")) {
    const factKey = qNorm.replace(/^__FACT:/, "").replace(/__$/, "").trim();
    return getFactAnswer(exhibit, factKey);
  }

  if (isCreatorQuestion(qNormRaw) || qNormRaw === "מי היוצר/ת") {
    const creatorName = String(exhibit.creatorName || "").trim();
    const creatorBio = String(exhibit.creatorBio || "").trim();
    return buildCreatorAnswer(creatorName, creatorBio);
  }

  return "במצב הדגמה מקומי אני עונה רק מתוך הכפתורים והעובדות שהוזנו. אפשר ללחוץ על אחת האפשרויות למעלה.";
}

exports.handler = async (event) => {
  const debugMode = event.queryStringParameters?.debug === "1";
  const t0 = Date.now();

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...getCorsHeaders(event),
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  // Health check (prevents 405 noise in console)
  if (event.httpMethod === "GET") {
    return jsonResponse(event, 200, {
      ok: true,
      fn: "chat",
      appEnv: APP_ENV,
      netlifyContext: NETLIFY_CONTEXT,
      usageWriteEnabled: ALLOW_USAGE_WRITE,
      hasSupabase: !!supabase,
      hasOpenAiKey: !!process.env.OPENAI_API_KEY,
      timeUtc: new Date().toISOString(),
      debugHint: "Use POST for chat. Add ?debug=1 on POST to see debug payload.",
    });
  }

  let lastTrackStatus = null;

  const safeTrack = (args) => {
    const fnMs = Date.now() - t0;
    trackUsage({ ...args, fnMs })
      .then((s) => {
        lastTrackStatus = s;
      })
      .catch((e) => console.log("trackUsage failed:", e));
  };

  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(event, 405, { error: "Method not allowed", method: event.httpMethod });
    }

    const body = JSON.parse(event.body || "{}");
    const exhibitId = body.exhibitId;
    const question = body.question;

    const museumIdFromClient = body.museumId || null;
    const exhibitionIdFromClient = body.exhibitionId || null;

    if (!exhibitId || !question) {
      return jsonResponse(event, 400, { error: "Missing exhibitId or question" });
    }

    const baseUrl = resolveBaseUrl(event, body);
    if (!baseUrl) {
      return jsonResponse(event, 500, { error: "Cannot resolve baseUrl" });
    }

    const { museumDbId, exhibitionDbId, museumSlug, exhibitionSlug } = await resolveMuseumAndExhibition({
      museumId: museumIdFromClient,
      exhibitionId: exhibitionIdFromClient,
    });

    const monthKey = getMonthKeyUtc();

    const qNormRaw = normalizeQuestion(question);
    const qNorm = mapPlainButtonToCommand(qNormRaw);

    const exhibitsData = await getExhibitsData({
      baseUrl,
      museumId: museumSlug,
      exhibitionId: exhibitionSlug,
    });

    const exhibit = exhibitsData?.exhibits?.[exhibitId];
    if (!exhibit) {
      return jsonResponse(event, 404, { error: "Exhibit not found" });
    }

    const cacheKey = `${museumSlug}||${exhibitionSlug}||${exhibitId}||${qNorm}`;

    const cachedAnswer = cacheGet(cacheKey);
    if (cachedAnswer) {
      safeTrack({
        museumId: museumDbId,
        monthKey,
        exhibitId,
        exhibitionId: exhibitionDbId,
        mode: "fast",
        cached: true,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        openaiCostUsd: 0,
      });

      return jsonResponse(event, 200, {
        answer: cachedAnswer,
        cached: true,
        ...(debugMode
          ? {
              debug: {
                mode: "cache",
                museumDbId,
                museumSlug,
                exhibitionDbId,
                exhibitionSlug,
                exhibitId,
                monthKey,
                baseUrl,
                contentPath: buildContentPath({ museumId: museumSlug, exhibitionId: exhibitionSlug }),
                lastTrackStatus,
              },
            }
          : {}),
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    // Demo mode: if no key, answer safely without OpenAI
    if (!apiKey) {
      const answer = buildDemoAnswer({ exhibit, qNorm, qNormRaw });

      cacheSet(cacheKey, answer);

      safeTrack({
        museumId: museumDbId,
        monthKey,
        exhibitId,
        exhibitionId: exhibitionDbId,
        mode: "demo",
        cached: false,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        openaiCostUsd: 0,
      });

      return jsonResponse(event, 200, {
        answer,
        demo: true,
        ...(debugMode
          ? {
              debug: {
                mode: "demo",
                museumDbId,
                museumSlug,
                exhibitionDbId,
                exhibitionSlug,
                exhibitId,
                monthKey,
                baseUrl,
                contentPath: buildContentPath({ museumId: museumSlug, exhibitionId: exhibitionSlug }),
                lastTrackStatus,
              },
            }
          : {}),
      });
    }

    // OpenAI mode
    const exhibitionSummary = exhibitsData?.museum?.exhibitionSummary || "";
    const fullDesc = stripHtml(exhibit.exhibitDescriptionHtml || "");
    const exhibitSummary = limitChars(fullDesc, 1500);

    const context = {
      exhibitionSummary,
      creatorName: exhibit.creatorName || "",
      creatorBio: exhibit.creatorBio || "",
      title: exhibit.title,
      subtitle: exhibit.subtitle,
      tags: exhibit.tags,
      facts: exhibit.facts,
      curatorNotes: exhibit.curatorNotes,
      exhibitSummary,
    };

    const system = `
את/ה מדריך/ה אינטראקטיבי/ת שקט/ה במוזיאון.
חובה:
- לענות בעברית, בניסוח נעים ומכבד.
- לענות רק על בסיס המידע שמופיע ב-Context.
- אם אין מספיק מידע ב-Context כדי לענות: לומר בדיוק:
  "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג."
- לא להמציא עובדות, שמות, תאריכים, או פרטים שלא מופיעים ב-Context.
- לא להוסיף קישורים ולא להפנות לאינטרנט.
- תשובה קצרה (עד ~120 מילים), אלא אם המשתמש ביקש במפורש פירוט.
`;

    const userPrompt = `
Context (המידע היחיד שמותר להשתמש בו):
${JSON.stringify(context, null, 2)}

שאלת המבקר:
${qNormRaw}
`;

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        input: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    const openaiJson = await openaiRes.json();
    if (!openaiRes.ok) {
      safeTrack({
        museumId: museumDbId,
        monthKey,
        exhibitId,
        exhibitionId: exhibitionDbId,
        mode: "openai",
        cached: false,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        openaiCostUsd: 0,
      });

      return jsonResponse(event, 500, {
        error: "OpenAI error",
        details: openaiJson,
        ...(debugMode
          ? {
              debug: {
                mode: "openai_error",
                museumDbId,
                museumSlug,
                exhibitionDbId,
                exhibitionSlug,
                exhibitId,
                monthKey,
                baseUrl,
                contentPath: buildContentPath({ museumId: museumSlug, exhibitionId: exhibitionSlug }),
                lastTrackStatus,
              },
            }
          : {}),
      });
    }

    const { inputTokens, outputTokens, totalTokens } = getUsageFromOpenAiResponse(openaiJson);
    const openaiCostUsd = estimateOpenAiCostUsd({ inputTokens, outputTokens });

    const answer = extractText(openaiJson) || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";

    cacheSet(cacheKey, answer);

    safeTrack({
      museumId: museumDbId,
      monthKey,
      exhibitId,
      exhibitionId: exhibitionDbId,
      mode: "openai",
      cached: false,
      inputTokens,
      outputTokens,
      totalTokens,
      openaiCostUsd,
    });

    return jsonResponse(event, 200, {
      answer,
      usage: { inputTokens, outputTokens, totalTokens, openaiCostUsd },
      ...(debugMode
        ? {
            debug: {
              mode: "openai_ok",
              museumDbId,
              museumSlug,
              exhibitionDbId,
              exhibitionSlug,
              exhibitId,
              monthKey,
              baseUrl,
              contentPath: buildContentPath({ museumId: museumSlug, exhibitionId: exhibitionSlug }),
              lastTrackStatus,
            },
          }
        : {}),
    });
  } catch (err) {
    return jsonResponse(event, 500, {
      error: "Server error",
      details: String(err?.message || err),
    });
  }
};
