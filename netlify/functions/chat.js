const { createClient } = require("@supabase/supabase-js");

// --- Supabase client (reuse across warm invocations) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function getMuseumIdFromBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl).hostname; // stable museum id
  } catch {
    return "unknown";
  }
}

async function trackUsage({ museumId, exhibitId }) {
  if (!supabase) return;

  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const { error } = await supabase.rpc("usage_increment", {
    p_museum_id: museumId,
    p_month_key: monthKey,
    p_exhibit_id: exhibitId || null,
  });

  if (error) console.log("usage_increment error:", error);
}

// --- In-memory caches (survive on warm function instances) ---
const EXHIBITS_TTL_MS = 60 * 1000;        // 1 minute
const ANSWER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_CACHE_ITEMS = 500;

let exhibitsCache = { baseUrl: null, fetchedAt: 0, data: null };
const answerCache = new Map(); // key -> { answer, ts }

function nowMs() {
  return Date.now();
}

function normalizeQuestion(q) {
  return String(q || "")
    .trim()
    .replace(/\u05F3/g, "'") // Hebrew geresh
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

async function getExhibitsData(baseUrl) {
  if (
    exhibitsCache.data &&
    exhibitsCache.baseUrl === baseUrl &&
    nowMs() - exhibitsCache.fetchedAt < EXHIBITS_TTL_MS
  ) {
    return exhibitsCache.data;
  }

  const res = await fetch(`${baseUrl}/assets/exhibits.json`, { cache: "no-store" });
  const data = await res.json();

  exhibitsCache = { baseUrl, fetchedAt: nowMs(), data };
  return data;
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
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
  if (/תערוכ/i.test(normalized)) return false;

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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const debug = event.queryStringParameters?.debug === "1";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(500, { error: "Missing OPENAI_API_KEY" });
    }

    const { exhibitId, question } = JSON.parse(event.body || "{}");
    if (!exhibitId || !question) {
      return jsonResponse(400, { error: "Missing exhibitId or question" });
    }

    const origin = event.headers.origin || event.headers.referer || "";
    const baseUrl = origin ? new URL(origin).origin : null;
    if (!baseUrl) {
      return jsonResponse(500, { error: "Cannot resolve origin" });
    }

    // ✅ Track usage once per valid question (fire-and-forget, doesn't block response)
    const museumId = getMuseumIdFromBaseUrl(baseUrl);
    trackUsage({ museumId, exhibitId }).catch((e) => console.log("trackUsage failed:", e));
    if (debug) {
      await trackUsage({ museumId, exhibitId });
    }

    const qNormRaw = normalizeQuestion(question);
    const qNorm = mapPlainButtonToCommand(qNormRaw);

    const exhibitsData = await getExhibitsData(baseUrl);
    const exhibit = exhibitsData?.exhibits?.[exhibitId];
    if (!exhibit) {
      return jsonResponse(404, { error: "Exhibit not found" });
    }

    const cacheKey = `${exhibitId}||${qNorm}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return jsonResponse(200, { answer: cached, cached: true });
    }

    // --- Fast paths (NO OpenAI) ---
    if (qNorm === "__SUMMARY__") {
      const fullDesc = stripHtml(exhibit.exhibitDescriptionHtml || "");
      const answer =
        limitChars(fullDesc, 700) || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";
      cacheSet(cacheKey, answer);
      return jsonResponse(200, { answer, fast: "summary" });
    }

    if (qNorm.startsWith("__FACT:") && qNorm.endsWith("__")) {
      const factKey = qNorm.replace(/^__FACT:/, "").replace(/__$/, "").trim();
      const answer = getFactAnswer(exhibit, factKey);
      cacheSet(cacheKey, answer);
      return jsonResponse(200, { answer, fast: "fact" });
    }

    if (isCreatorQuestion(qNormRaw) || qNormRaw === "מי היוצר/ת") {
      const creatorName = String(exhibit.creatorName || "").trim();
      const creatorBio = String(exhibit.creatorBio || "").trim();
      const answer = buildCreatorAnswer(creatorName, creatorBio);
      cacheSet(cacheKey, answer);
      return jsonResponse(200, { answer, fast: "creator" });
    }

    // --- OpenAI path ---
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
- השתמש/י במונחים "היצירה" / "המיצג" כשעונים על exhibitSummary.
- השתמש/י במונח "התערוכה" רק כשמתייחסים במפורש ל-exhibitionSummary.
- אל תערבב/י בין המושגים.
`;

    const userPrompt = `
Context (המידע היחיד שמותר להשתמש בו):
${JSON.stringify(context, null, 2)}

הנחיה:
- העדף/י לענות קודם על בסיס facts.
- אם צריך, השתמש/י ב-exhibitSummary וב-exhibitionSummary.
- אם לא מופיע מידע ב-Context: החזר/י את משפט "אין לי מספיק מידע..." בדיוק.

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
      return jsonResponse(500, { error: "OpenAI error", details: openaiJson });
    }

    const answer =
      extractText(openaiJson) || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";
    cacheSet(cacheKey, answer);
    return jsonResponse(200, { answer });
  } catch (err) {
    return jsonResponse(500, { error: "Server error", details: String(err) });
  }
};
