// netlify/functions/usage.js
// Comments in English only

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function getMonthKeyUtc() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function jsonResponse(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function corsHeaders(event) {
  const origin = event.headers?.origin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

async function resolveMuseumAndExhibition({ museumId, exhibitionId }) {
  // Comments in English only

  const museumKey = String(museumId || "").trim();
  const exhibitionKey = String(exhibitionId || "").trim();

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

async function readMonthlyTotal({ museumDbId, exhibitionDbId, monthKey }) {
  // Comments in English only

  // Try with exhibition_id (if column exists)
  let res = await supabase
    .from("usage_monthly")
    .select("questions_total, exhibition_id")
    .eq("museum_id", museumDbId)
    .eq("month_key", monthKey)
    .eq("exhibition_id", exhibitionDbId)
    .maybeSingle();

  if (res.error && /column .*exhibition_id/i.test(res.error.message || "")) {
    // Fallback: table has no exhibition_id column
    res = await supabase
      .from("usage_monthly")
      .select("questions_total")
      .eq("museum_id", museumDbId)
      .eq("month_key", monthKey)
      .maybeSingle();
  }

  if (res.error) throw new Error(`usage_monthly query failed: ${res.error.message}`);
  return Number(res.data?.questions_total ?? 0);
}

async function readMonthlyBreakdown({ museumDbId, exhibitionDbId, monthKey }) {
  // Comments in English only

  // Try with exhibition_id (if column exists)
  let res = await supabase
    .from("usage_monthly_exhibit")
    .select("exhibit_id, questions_total, exhibition_id")
    .eq("museum_id", museumDbId)
    .eq("month_key", monthKey)
    .eq("exhibition_id", exhibitionDbId)
    .order("questions_total", { ascending: false });

  if (res.error && /column .*exhibition_id/i.test(res.error.message || "")) {
    // Fallback: table has no exhibition_id column
    res = await supabase
      .from("usage_monthly_exhibit")
      .select("exhibit_id, questions_total")
      .eq("museum_id", museumDbId)
      .eq("month_key", monthKey)
      .order("questions_total", { ascending: false });
  }

  if (res.error) throw new Error(`usage_monthly_exhibit query failed: ${res.error.message}`);

  const rows = Array.isArray(res.data) ? res.data : [];
  return rows.map((r) => ({
    exhibitId: r.exhibit_id,
    questionsTotal: Number(r.questions_total ?? 0),
  }));
}

exports.handler = async (event) => {
  const debugMode = event.queryStringParameters?.debug === "1";
  const breakdown = event.queryStringParameters?.breakdown === "1";
  const t0 = Date.now();

  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true }, corsHeaders(event));
  }

  const debug = {
    ok: false,
    stage: "start",
    httpMethod: event.httpMethod,
    hasSupabase: !!supabase,
    qs: debugMode ? event.queryStringParameters : undefined,
    ms: 0,
  };

  try {
    if (event.httpMethod !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" }, corsHeaders(event));
    }

    const monthKey = getMonthKeyUtc();

    // Accept both names used in the site
    const museumId = event.queryStringParameters?.museumId || event.queryStringParameters?.museum || null;
    const exhibitionId = event.queryStringParameters?.exhibitionId || event.queryStringParameters?.exhibition || null;

    debug.stage = "resolve_tenant";

    if (!supabase) {
      debug.ok = true;
      debug.ms = Date.now() - t0;
      return jsonResponse(
        200,
        breakdown
          ? { monthKey, questionsTotal: 0, exhibits: [], debug: debugMode ? debug : undefined }
          : { monthKey, questionsTotal: 0, debug: debugMode ? debug : undefined },
        corsHeaders(event)
      );
    }

    const tenant = await resolveMuseumAndExhibition({ museumId, exhibitionId });
    const { museumDbId, exhibitionDbId, museumSlug, exhibitionSlug } = tenant;

    debug.tenant = debugMode ? { museumId, exhibitionId, museumDbId, exhibitionDbId, museumSlug, exhibitionSlug } : undefined;

    debug.stage = "read_total";
    const questionsTotal = await readMonthlyTotal({ museumDbId, exhibitionDbId, monthKey });

    if (!breakdown) {
      debug.ok = true;
      debug.ms = Date.now() - t0;
      return jsonResponse(
        200,
        { monthKey, questionsTotal, debug: debugMode ? debug : undefined },
        corsHeaders(event)
      );
    }

    debug.stage = "read_breakdown";
    const exhibits = await readMonthlyBreakdown({ museumDbId, exhibitionDbId, monthKey });

    debug.ok = true;
    debug.ms = Date.now() - t0;

    return jsonResponse(
      200,
      { monthKey, questionsTotal, exhibits, debug: debugMode ? debug : undefined },
      corsHeaders(event)
    );
  } catch (err) {
    debug.stage = "catch";
    debug.error = String(err?.message || err);
    debug.ms = Date.now() - t0;

    return jsonResponse(
      500,
      { error: "usage_failed", details: debug.error, debug: debugMode ? debug : undefined },
      corsHeaders(event)
    );
  }
};
