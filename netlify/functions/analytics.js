// netlify/functions/analytics.js
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const ALLOWED_EVENTS = new Set([
  "app_open",
  "exhibit_view",
  "quick_question_click",
  "free_question_submit",
  "chat_answer_received",
  "audio_play_click",
  "audio_pause_click",
  "audio_complete",
  "video_play_click",
  "chat_reset_click",
  "chat_send_click",
  "ui_error",
  "chat_error",
  "open_external_link",
]);

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || "*";

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" }, origin);
  }

  if (!supabase) {
    return json(500, { error: "Supabase is not configured" }, origin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" }, origin);
  }

  const eventName = String(body.eventName || "").trim();
  const sessionId = String(body.sessionId || "").trim();

  if (!ALLOWED_EVENTS.has(eventName)) {
    return json(400, { error: "Invalid eventName" }, origin);
  }

  if (!sessionId || sessionId.length > 128) {
    return json(400, { error: "Invalid sessionId" }, origin);
  }

  const row = {
    event_name: eventName,
    museum_id: body.museumId ? String(body.museumId).trim() : null,
    exhibition_id: body.exhibitionId ? String(body.exhibitionId).trim() : null,
    exhibit_id: body.exhibitId ? String(body.exhibitId).trim() : null,
    session_id: sessionId,
    page: body.page ? String(body.page).trim().slice(0, 50) : null,
    source: "web",
    meta: typeof body.meta === "object" && body.meta ? body.meta : {},
  };

  const { error } = await supabase.from("analytics_events").insert([row]);
  if (error) return json(500, { error: "Insert failed", details: error.message }, origin);

  return json(200, { ok: true }, origin);
};
