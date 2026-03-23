const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEEPALIVE_ENABLED = process.env.SUPABASE_KEEPALIVE_ENABLED === "true";

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

exports.handler = async (event) => {
  if (!KEEPALIVE_ENABLED) {
    console.log("supabase-keepalive skipped: disabled");
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, skipped: "disabled" }),
    };
  }

  if (!supabase) {
    console.error("supabase-keepalive failed: missing Supabase env");
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "supabase_not_configured" }),
    };
  }

  const startedAt = Date.now();
  const { data, error } = await supabase
    .from("museums")
    .select("museum_id")
    .limit(1);

  if (error) {
    console.error("supabase-keepalive failed", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message }),
    };
  }

  const durationMs = Date.now() - startedAt;
  console.log("supabase-keepalive ok", {
    touchedRows: Array.isArray(data) ? data.length : 0,
    durationMs,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      touchedRows: Array.isArray(data) ? data.length : 0,
      durationMs,
    }),
  };
};
