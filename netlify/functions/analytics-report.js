const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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

function parseDate(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseRangeDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

function fmtDateUtc(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateDaysAgo(daysAgo) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return fmtDateUtc(d);
}

function safeDiv(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function isAllZeroTotals(totals) {
  return (
    Number(totals.appOpenSessions || 0) === 0 &&
    Number(totals.exhibitViewEvents || 0) === 0 &&
    Number(totals.exhibitViewSessions || 0) === 0 &&
    Number(totals.quickQuestionClicks || 0) === 0 &&
    Number(totals.freeQuestionSubmits || 0) === 0 &&
    Number(totals.chatAnswers || 0) === 0 &&
    Number(totals.videoPlayClicks || 0) === 0 &&
    Number(totals.audioPlayClicks || 0) === 0
  );
}

function normalizeRawEventDay(createdAt) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return fmtDateUtc(d);
}

function isMissingAnalyticsAggregate(err) {
  const message = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  return (
    code === "42p01" ||
    code === "42883" ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("relation") ||
    message.includes("function analytics_rollup_for_day")
  );
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || "*";

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" }, origin);
  }

  if (!supabase) {
    return json(500, { error: "Supabase is not configured" }, origin);
  }

  const qs = event.queryStringParameters || {};
  const museumId = String(qs.museumId || qs.museum || "").trim() || null;
  const exhibitionId = String(qs.exhibitionId || qs.exhibition || "").trim() || null;

  const fromInput = parseDate(qs.from);
  const toInput = parseDate(qs.to);
  const rangeDays = parseRangeDays(qs.rangeDays);

  const to = toInput || dateDaysAgo(0);
  const from = fromInput || dateDaysAgo(rangeDays - 1);

  if (from > to) {
    return json(400, { error: "Invalid range: from must be <= to" }, origin);
  }

  try {
    // Keep dashboard near-real-time:
    // refresh current UTC day rollup before reading aggregated tables.
    try {
      await supabase.rpc("analytics_rollup_for_day", { p_day: dateDaysAgo(0) });
    } catch {
      // Ignore: function may not exist yet in some environments.
    }

    let source = "daily_aggregates";
    let byDay = [];
    let topExhibits = [];
    let totals = {
      appOpenSessions: 0,
      exhibitViewEvents: 0,
      exhibitViewSessions: 0,
      quickQuestionClicks: 0,
      freeQuestionSubmits: 0,
      chatAnswers: 0,
      videoPlayClicks: 0,
      audioPlayClicks: 0,
    };

    let aggregateUnavailable = false;
    let funnelRows = [];
    let rollupRows = [];

    let funnelQuery = supabase
      .from("analytics_daily_funnel")
      .select(
        "day,museum_id,exhibition_id,app_open_sessions,exhibit_view_sessions,quick_question_clicks,free_question_submits,chat_answers,video_play_clicks,audio_play_clicks"
      )
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: true });

    if (museumId) funnelQuery = funnelQuery.eq("museum_id", museumId);
    if (exhibitionId) funnelQuery = funnelQuery.eq("exhibition_id", exhibitionId);

    const { data: funnelData, error: funnelError } = await funnelQuery;
    if (funnelError) {
      if (isMissingAnalyticsAggregate(funnelError)) {
        aggregateUnavailable = true;
      } else {
        return json(500, { error: "funnel_query_failed", details: funnelError.message }, origin);
      }
    } else {
      funnelRows = funnelData || [];
    }

    if (!aggregateUnavailable) {
      let topExhibitsQuery = supabase
        .from("analytics_daily_rollup")
        .select("exhibit_id,events_count")
        .eq("event_name", "exhibit_view")
        .gte("day", from)
        .lte("day", to);

      if (museumId) topExhibitsQuery = topExhibitsQuery.eq("museum_id", museumId);
      if (exhibitionId) topExhibitsQuery = topExhibitsQuery.eq("exhibition_id", exhibitionId);

      const { data: rollupData, error: rollupError } = await topExhibitsQuery;
      if (rollupError) {
        if (isMissingAnalyticsAggregate(rollupError)) {
          aggregateUnavailable = true;
        } else {
          return json(500, { error: "rollup_query_failed", details: rollupError.message }, origin);
        }
      } else {
        rollupRows = rollupData || [];
      }
    }

    if (!aggregateUnavailable) {
      for (const row of funnelRows) {
        totals.appOpenSessions += Number(row.app_open_sessions || 0);
        totals.exhibitViewSessions += Number(row.exhibit_view_sessions || 0);
        totals.quickQuestionClicks += Number(row.quick_question_clicks || 0);
        totals.freeQuestionSubmits += Number(row.free_question_submits || 0);
        totals.chatAnswers += Number(row.chat_answers || 0);
        totals.videoPlayClicks += Number(row.video_play_clicks || 0);
        totals.audioPlayClicks += Number(row.audio_play_clicks || 0);
      }

      const topMap = new Map();
      for (const row of rollupRows) {
        const key = String(row.exhibit_id || "unknown");
        const prev = topMap.get(key) || 0;
        topMap.set(key, prev + Number(row.events_count || 0));
      }
      totals.exhibitViewEvents = Array.from(topMap.values()).reduce((a, b) => a + Number(b || 0), 0);
      topExhibits = Array.from(topMap.entries())
        .map(([exhibitId, exhibitViews]) => ({ exhibitId, exhibitViews }))
        .sort((a, b) => b.exhibitViews - a.exhibitViews)
        .slice(0, 10);

      byDay = funnelRows;
    }

    // Fallback to raw events if daily aggregates are empty/stale.
    if (aggregateUnavailable || !byDay.length || isAllZeroTotals(totals)) {
      const fromTs = `${from}T00:00:00.000Z`;
      const toTs = `${to}T23:59:59.999Z`;

      let rawQuery = supabase
        .from("analytics_events")
        .select("created_at,event_name,session_id,exhibit_id,museum_id,exhibition_id")
        .gte("created_at", fromTs)
        .lte("created_at", toTs);

      if (museumId) rawQuery = rawQuery.eq("museum_id", museumId);
      if (exhibitionId) rawQuery = rawQuery.eq("exhibition_id", exhibitionId);

      const { data: rawRows, error: rawError } = await rawQuery;
      if (rawError) {
        return json(500, { error: "raw_fallback_failed", details: rawError.message }, origin);
      }

      if (Array.isArray(rawRows) && rawRows.length) {
        source = aggregateUnavailable ? "raw_missing_aggregates_fallback" : "raw_fallback";
        totals = {
          appOpenSessions: 0,
          exhibitViewEvents: 0,
          exhibitViewSessions: 0,
          quickQuestionClicks: 0,
          freeQuestionSubmits: 0,
          chatAnswers: 0,
          videoPlayClicks: 0,
          audioPlayClicks: 0,
        };
        topMap = new Map();

        const sessionsByEvent = {
          app_open: new Set(),
          exhibit_view: new Set(),
        };

        const byDayMap = new Map();
        for (const row of rawRows) {
          const ev = String(row.event_name || "");
          const sid = String(row.session_id || "");
          const exhibit = String(row.exhibit_id || "unknown");
          const day = normalizeRawEventDay(row.created_at) || from;

          if (!byDayMap.has(day)) {
            byDayMap.set(day, {
              day,
              museum_id: museumId,
              exhibition_id: exhibitionId,
              app_open_sessions: 0,
              exhibit_view_sessions: 0,
              quick_question_clicks: 0,
              free_question_submits: 0,
              chat_answers: 0,
              video_play_clicks: 0,
              audio_play_clicks: 0,
              _appSessions: new Set(),
              _viewSessions: new Set(),
            });
          }
          const dayRow = byDayMap.get(day);

          if (ev === "app_open") {
            sessionsByEvent.app_open.add(sid);
            dayRow._appSessions.add(sid);
          } else if (ev === "exhibit_view") {
            sessionsByEvent.exhibit_view.add(sid);
            dayRow._viewSessions.add(sid);
            topMap.set(exhibit, (topMap.get(exhibit) || 0) + 1);
            totals.exhibitViewEvents += 1;
          } else if (ev === "quick_question_click") {
            totals.quickQuestionClicks += 1;
            dayRow.quick_question_clicks += 1;
          } else if (ev === "free_question_submit") {
            totals.freeQuestionSubmits += 1;
            dayRow.free_question_submits += 1;
          } else if (ev === "chat_answer_received") {
            totals.chatAnswers += 1;
            dayRow.chat_answers += 1;
          } else if (ev === "video_play_click") {
            totals.videoPlayClicks += 1;
            dayRow.video_play_clicks += 1;
          } else if (ev === "audio_play_click") {
            totals.audioPlayClicks += 1;
            dayRow.audio_play_clicks += 1;
          }
        }

        totals.appOpenSessions = sessionsByEvent.app_open.size;
        totals.exhibitViewSessions = sessionsByEvent.exhibit_view.size;

        byDay = Array.from(byDayMap.values())
          .map((r) => ({
            day: r.day,
            museum_id: r.museum_id,
            exhibition_id: r.exhibition_id,
            app_open_sessions: r._appSessions.size,
            exhibit_view_sessions: r._viewSessions.size,
            quick_question_clicks: r.quick_question_clicks,
            free_question_submits: r.free_question_submits,
            chat_answers: r.chat_answers,
            video_play_clicks: r.video_play_clicks,
            audio_play_clicks: r.audio_play_clicks,
          }))
          .sort((a, b) => String(a.day).localeCompare(String(b.day)));

        topExhibits = Array.from(topMap.entries())
          .map(([exhibitId, exhibitViews]) => ({ exhibitId, exhibitViews }))
          .sort((a, b) => b.exhibitViews - a.exhibitViews)
          .slice(0, 10);
      }
    }

    const conversion = {
      chatFromViewsPercent: safeDiv(totals.chatAnswers, totals.exhibitViewSessions),
      freeFromViewsPercent: safeDiv(
        totals.freeQuestionSubmits,
        totals.exhibitViewSessions
      ),
      quickFromViewsPercent: safeDiv(
        totals.quickQuestionClicks,
        totals.exhibitViewSessions
      ),
    };

    return json(
      200,
      {
        ok: true,
        range: { from, to, rangeDays },
        scope: { museumId, exhibitionId },
        source,
        totals,
        conversion,
        topExhibits,
        byDay,
      },
      origin
    );
  } catch (err) {
    return json(
      500,
      { error: "analytics_report_failed", details: String(err?.message || err) },
      origin
    );
  }
};
