// netlify/functions/usage.js (replace fully)
// Comments in English only

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

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

function getBaseUrlFromEvent(event) {
  const origin = event.headers?.origin || "";
  const referer = event.headers?.referer || "";

  try { if (origin) return new URL(origin).origin; } catch {}
  try { if (referer) return new URL(referer).origin; } catch {}

  return null;
}

function getMuseumIdFromBaseUrl(baseUrl) {
  // Legacy fallback only (previous behavior)
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "unknown";
  }
}

function getMonthKeyUtc(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function resolveMuseumAndExhibition({ museumId, exhibitionId, baseUrl }) {
  // If Supabase not configured - just pass through
  if (!supabase) {
    return {
      museumId: museumId || getMuseumIdFromBaseUrl(baseUrl),
      exhibitionId: exhibitionId || "default_exhibition",
      enforced: false,
    };
  }

  const resolvedMuseumId = museumId || getMuseumIdFromBaseUrl(baseUrl);
  const resolvedExhibitionId = exhibitionId || "default_exhibition";

  // Validate only when explicitly provided (so old links keep working)
  if (museumId) {
    const { data, error } = await supabase
      .from("museums")
      .select("museum_id")
      .eq("museum_id", resolvedMuseumId)
      .maybeSingle();

    if (error) throw new Error(`Supabase museums lookup failed: ${error.message}`);
    if (!data) throw new Error("Invalid museumId");
  }

  if (exhibitionId) {
    const { data, error } = await supabase
      .from("exhibitions")
      .select("exhibition_id, museum_id")
      .eq("exhibition_id", resolvedExhibitionId)
      .eq("museum_id", resolvedMuseumId)
      .maybeSingle();

    if (error) throw new Error(`Supabase exhibitions lookup failed: ${error.message}`);
    if (!data) throw new Error("Invalid exhibitionId for this museumId");
  }

  return { museumId: resolvedMuseumId, exhibitionId: resolvedExhibitionId, enforced: true };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    if (!supabase) {
      return jsonResponse(500, { error: "Missing Supabase env vars" });
    }

    const baseUrl = getBaseUrlFromEvent(event) || "http://unknown.local";

    const url = new URL(event.rawUrl);

    // New multi-tenant IDs (optional)
    const museumIdFromClient = url.searchParams.get("museumId") || url.searchParams.get("museum") || null;
    const exhibitionIdFromClient =
      url.searchParams.get("exhibitionId") || url.searchParams.get("exhibition") || null;

    // Existing params
    const exhibitId = url.searchParams.get("exhibitId"); // optional
    const breakdown = url.searchParams.get("breakdown") === "1"; // optional

    const { museumId, exhibitionId } = await resolveMuseumAndExhibition({
      museumId: museumIdFromClient,
      exhibitionId: exhibitionIdFromClient,
      baseUrl,
    });

    const monthKey = getMonthKeyUtc();

    // Total monthly (per museum + exhibition)
    const { data: totalRow, error: totalErr } = await supabase
      .from("usage_monthly")
      .select("questions_total")
      .eq("museum_id", museumId)
      .eq("exhibition_id", exhibitionId)
      .eq("month_key", monthKey)
      .maybeSingle();

    if (totalErr) {
      console.log("usage_monthly select error:", totalErr);
      return jsonResponse(500, { error: "DB error" });
    }

    const questionsTotal = Number(totalRow?.questions_total ?? 0);

    // Per-exhibit (single exhibit)
    let exhibitQuestionsTotal = null;
    if (exhibitId) {
      const { data: exRow, error: exErr } = await supabase
        .from("usage_monthly_exhibit")
        .select("questions_total")
        .eq("museum_id", museumId)
        .eq("exhibition_id", exhibitionId)
        .eq("month_key", monthKey)
        .eq("exhibit_id", exhibitId)
        .maybeSingle();

      if (exErr) {
        console.log("usage_monthly_exhibit select error:", exErr);
        return jsonResponse(500, { error: "DB error" });
      }

      exhibitQuestionsTotal = Number(exRow?.questions_total ?? 0);
    }

    // Per-exhibit breakdown list (top 50)
    let exhibits = null;
    if (breakdown) {
      const { data: rows, error: listErr } = await supabase
        .from("usage_monthly_exhibit")
        .select("exhibit_id, questions_total")
        .eq("museum_id", museumId)
        .eq("exhibition_id", exhibitionId)
        .eq("month_key", monthKey)
        .order("questions_total", { ascending: false })
        .limit(50);

      if (listErr) {
        console.log("usage_monthly_exhibit list error:", listErr);
        return jsonResponse(500, { error: "DB error" });
      }

      exhibits = (rows || []).map((r) => ({
        exhibitId: r.exhibit_id,
        questionsTotal: Number(r.questions_total ?? 0),
      }));
    }

    return jsonResponse(200, {
      museumId,
      exhibitionId,
      monthKey,
      questionsTotal,
      exhibitId: exhibitId || null,
      exhibitQuestionsTotal,
      exhibits,
    });
  } catch (err) {
    return jsonResponse(500, { error: "Server error", details: String(err?.message || err) });
  }
};
