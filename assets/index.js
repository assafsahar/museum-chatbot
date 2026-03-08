// assets/index.js
// Comments in English only

import { initGaReliability, trackGaError } from "./modules/gaTelemetry.js";

(async () => {
  const params = new URLSearchParams(location.search);
  const tenantParam = (params.get("tenant") || params.get("vertical") || "").trim().toLowerCase();
  const host = String(location.hostname || "").toLowerCase();
  const tenant = tenantParam || (host.includes("winery") ? "winery" : "museum");
  const isWinery = tenant === "winery";
  const exhibitWordSingular = isWinery ? "יין" : "מיצג";
  const exhibitWordPlural = isWinery ? "יינות" : "מיצגים";

  // Tenant params
  const museumId = params.get("museum") || params.get("museumId") || null;
  const exhibitionId = params.get("exhibition") || params.get("exhibitionId") || null;
  const gaCtx = { page: "dashboard", museumId, exhibitionId };
  initGaReliability(gaCtx);

  function buildQuery(extra) {
    const q = new URLSearchParams();
    if (museumId) q.set("museumId", museumId);
    if (exhibitionId) q.set("exhibitionId", exhibitionId);

    Object.entries(extra || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      q.set(k, String(v));
    });

    return q.toString();
  }

  function buildExhibitHref(exhibitKey) {
    const q = new URLSearchParams();
    q.set("id", exhibitKey);

    // Keep tenant context when navigating into exhibit page
    if (tenant) q.set("tenant", tenant);
    if (museumId) q.set("museum", museumId);
    if (exhibitionId) q.set("exhibition", exhibitionId);

    return `exhibit.html?${q.toString()}`;
  }

  function getContentUrl() {
    // If both exist, load per-tenant file. Otherwise keep legacy behavior.
    if (museumId && exhibitionId) {
      const m = encodeURIComponent(String(museumId).trim());
      const e = encodeURIComponent(String(exhibitionId).trim());
      return `assets/content/${m}/${e}.json`;
    }
    return "assets/exhibits.json";
  }

  // Load exhibition + exhibits list
  const contentUrl = getContentUrl();

  let data = null;
  try {
    const res = await fetch(contentUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`content http ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.log("content load failed:", e);
    trackGaError(gaCtx, "content_load_failed", { status: String(e?.message || "") });
    return;
  }

  const exhibitionImg = document.getElementById("exhibitionImg");
  const exhibitionTitle = document.getElementById("exhibitionTitle");
  const exhibitionCurator = document.getElementById("exhibitionCurator");
  const exhibitionSummary = document.getElementById("exhibitionSummary");

  if (exhibitionTitle) exhibitionTitle.textContent = data.museum?.exhibitionTitle || "";
  const curatorName =
    (data.museum?.exhibitionCurator || data.museum?.curatorName || data.museum?.curator || "").trim();
  if (exhibitionCurator) {
    if (curatorName) {
      exhibitionCurator.textContent = `אוצר/ת: ${curatorName}`;
      exhibitionCurator.style.display = "block";
    } else {
      exhibitionCurator.style.display = "none";
    }
  }
  if (exhibitionSummary) exhibitionSummary.textContent = data.museum?.exhibitionSummary || "";

  const imgSrc = (data.museum?.exhibitionImage || "").trim();
  if (exhibitionImg) {
    if (imgSrc) {
      exhibitionImg.src = imgSrc;
      exhibitionImg.style.display = "block";
    } else {
      exhibitionImg.style.display = "none";
    }
  }

  const museumName = document.getElementById("museumName");
  const museumLogo = document.getElementById("museumLogo");
  const list = document.getElementById("list");
  const dashboardSubLabelEl = document.querySelector(".brand .small");
  const exhibitsSectionTitleEl = list?.previousElementSibling || null;
  const usageBreakdownEl = document.getElementById("usageBreakdown");
  const usageBreakdownSectionTitleEl = usageBreakdownEl?.previousElementSibling || null;

  if (dashboardSubLabelEl && isWinery) {
    dashboardSubLabelEl.textContent = "בחר/י יין לדוגמה";
  }
  if (exhibitsSectionTitleEl) {
    exhibitsSectionTitleEl.textContent = exhibitWordPlural;
  }
  if (usageBreakdownSectionTitleEl) {
    usageBreakdownSectionTitleEl.textContent = `התפלגות שימוש החודש לפי ${exhibitWordSingular}`;
  }

  if (museumName) museumName.textContent = data.museum?.name || "מוזיאון";
  if (museumLogo) museumLogo.src = data.museum?.logo || "assets/logo.png";

  const exhibitsMap = data.exhibits || {};

  if (list) {
    list.innerHTML = "";
    Object.entries(exhibitsMap).forEach(([id, ex]) => {
      const row = document.createElement("div");
      row.className = "exhibitRow";

      const a = document.createElement("a");
      a.href = buildExhibitHref(encodeURIComponent(id));
      a.className = "exhibitLink";
      a.innerHTML = `<b>${ex.title || id}</b><div class="small">${ex.subtitle || ""}</div>`;

      row.appendChild(a);
      list.appendChild(row);
    });
  }

  // Load usage pill (monthly questions count)
  const usageCountEl = document.getElementById("usageCount");
  const usageMonthEl = document.getElementById("usageMonth");
  const usagePillEl = document.querySelector(".usage-pill");

  function renderQuotaHint(quota) {
    if (!usagePillEl) return;

    let hintEl = document.getElementById("usageQuotaHint");
    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.id = "usageQuotaHint";
      hintEl.className = "small";
      hintEl.style.marginTop = "6px";
      hintEl.style.textAlign = "center";
      usagePillEl.appendChild(hintEl);
    }

    let badgeEl = document.getElementById("usageQuotaBadge");
    if (!badgeEl) {
      badgeEl = document.createElement("div");
      badgeEl.id = "usageQuotaBadge";
      badgeEl.className = "small";
      badgeEl.style.marginTop = "6px";
      badgeEl.style.textAlign = "center";
      badgeEl.style.fontWeight = "700";
      badgeEl.style.display = "inline-block";
      badgeEl.style.padding = "2px 8px";
      badgeEl.style.borderRadius = "999px";
      badgeEl.style.border = "1px solid #d9deea";
      badgeEl.style.background = "#f3f6fb";
      badgeEl.style.color = "#46506a";
      badgeEl.style.marginInline = "auto";
      badgeEl.style.width = "fit-content";
      usagePillEl.appendChild(badgeEl);
    }

    if (!quota || !quota.quotaEnabled || !quota.isActive) {
      hintEl.textContent = "";
      badgeEl.textContent = "";
      badgeEl.style.display = "none";
      return;
    }

    const used = Number(quota.usedQuestions ?? 0);
    const limit = Number(quota.quotaLimitQuestions ?? 0);
    const pct = Number(quota.percentUsed ?? 0);
    const status = quota.shouldBlock ? "חסום" : quota.shouldWarn ? "אזהרה" : "תקין";

    if (status === "חסום") {
      badgeEl.style.display = "inline-block";
      badgeEl.style.background = "#fdecec";
      badgeEl.style.borderColor = "#f2c3c3";
      badgeEl.style.color = "#b42318";
    } else if (status === "אזהרה") {
      badgeEl.style.display = "inline-block";
      badgeEl.style.background = "#fff4e5";
      badgeEl.style.borderColor = "#f6d19b";
      badgeEl.style.color = "#b54708";
    } else {
      badgeEl.style.display = "inline-block";
      badgeEl.style.background = "#edf7ed";
      badgeEl.style.borderColor = "#b7dfb9";
      badgeEl.style.color = "#1f7a35";
    }
    badgeEl.textContent = status;

    const line1 = Number.isFinite(limit) && limit > 0 ? `בנק שאלות: ${used}/${limit}` : `בנק שאלות: ${used}`;
    const line2 = Number.isFinite(pct) ? `ניצול: ${pct}%` : "";
    hintEl.style.color = quota.shouldBlock ? "#b42318" : quota.shouldWarn ? "#b54708" : "#46506a";
    hintEl.textContent = line2 ? `${line1} | ${line2}` : line1;
  }

  try {
    const qs = buildQuery({});
    const url = qs ? `/.netlify/functions/usage?${qs}` : "/.netlify/functions/usage";

    const usageRes = await fetch(url, { cache: "no-store" });
    const usageJson = await usageRes.json();

    if (usageCountEl) usageCountEl.textContent = String(usageJson?.questionsTotal ?? 0);
    if (usageMonthEl) usageMonthEl.textContent = String(usageJson?.monthKey ?? "—");
    renderQuotaHint(usageJson?.quota || null);
  } catch {
    trackGaError(gaCtx, "usage_load_failed", {});
    if (usageCountEl) usageCountEl.textContent = "—";
    if (usageMonthEl) usageMonthEl.textContent = "—";
    renderQuotaHint(null);
  }

  // Usage breakdown (monthly per exhibit)
  function renderUsageBreakdown(container, items, map) {
    if (!container) return;

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="small">אין עדיין שימושים החודש לפי ${exhibitWordPlural}.</div>`;
      return;
    }

    const rows = items.map((r) => {
      const exhibitId = r.exhibitId;
      const title = map?.[exhibitId]?.title || exhibitId;
      const count = Number(r.questionsTotal ?? 0);

      return `
        <div class="usageRow">
          <div class="usageRow__title">${title}</div>
          <div class="usageRow__count">${count}</div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="usageHeader">
        <div class="usageHeader__title">${exhibitWordSingular}</div>
        <div class="usageHeader__count">שאלות</div>
      </div>
      ${rows.join("")}
    `;
  }

  async function loadUsageBreakdown(map) {
    const breakdownEl = document.getElementById("usageBreakdown");
    if (!breakdownEl) return;

    try {
      const qs = buildQuery({ breakdown: 1 });
      const url = qs ? `/.netlify/functions/usage?${qs}` : "/.netlify/functions/usage?breakdown=1";

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`usage breakdown http ${res.status}`);

      const json = await res.json();
      const items = json?.exhibits || [];
      renderUsageBreakdown(breakdownEl, items, map);
    } catch (e) {
      console.log("usage breakdown error:", e);
      trackGaError(gaCtx, "usage_breakdown_failed", { status: String(e?.message || "") });
      const breakdownEl = document.getElementById("usageBreakdown");
      if (breakdownEl) breakdownEl.innerHTML = `<div class="small">לא ניתן לטעון את ההתפלגות כרגע.</div>`;
    }
  }

function renderAnalyticsInsights(container, report, map) {
    if (!container) return;
    if (!report || !report.ok) {
      container.innerHTML = `<div class="small">לא ניתן לטעון תובנות כרגע.</div>`;
      return;
    }

    const totals = report.totals || {};
    const conversion = report.conversion || {};
    const topExhibits = Array.isArray(report.topExhibits) ? report.topExhibits : [];

    const viewSessions = Number(totals.exhibitViewSessions || 0);
    const chatPerSession =
      viewSessions > 0 ? Number((Number(totals.chatAnswers || 0) / viewSessions).toFixed(2)) : 0;
    const quickPerSession =
      viewSessions > 0
        ? Number((Number(totals.quickQuestionClicks || 0) / viewSessions).toFixed(2))
        : 0;
    const freePerSession =
      viewSessions > 0
        ? Number((Number(totals.freeQuestionSubmits || 0) / viewSessions).toFixed(2))
        : 0;

    const kpis = [
      {
        label: `צפיות ב${exhibitWordPlural}`,
        value: Number(totals.exhibitViewEvents || 0),
        sub: `sessions: ${Number(totals.exhibitViewSessions || 0)}`,
      },
      {
        label: "תשובות צ'אט",
        value: Number(totals.chatAnswers || 0),
        sub: `ממוצע לסשן: ${chatPerSession}`,
      },
      {
        label: "לחיצות כפתורים",
        value: Number(totals.quickQuestionClicks || 0),
        sub: `ממוצע לסשן: ${quickPerSession}`,
      },
      {
        label: "שאלות פתוחות",
        value: Number(totals.freeQuestionSubmits || 0),
        sub: `ממוצע לסשן: ${freePerSession}`,
      },
      {
        label: "ניגוני וידאו",
        value: Number(totals.videoPlayClicks || 0),
        sub: `אודיו: ${Number(totals.audioPlayClicks || 0)}`,
      },
    ];

    const topRows = topExhibits
      .map((row) => {
        const exhibitId = String(row.exhibitId || "");
        const title = map?.[exhibitId]?.title || exhibitId || "לא ידוע";
        const views = Number(row.exhibitViews || 0);
        return `
          <div class="insight-table__row">
            <div class="insight-table__left">${title}</div>
            <div class="insight-table__right">${views}</div>
          </div>
        `;
      })
      .join("");

    const from = report?.range?.from || "";
    const to = report?.range?.to || "";

    container.innerHTML = `
      <div class="small">טווח נתונים: ${from} עד ${to}</div>
      <div class="insights-grid">
        ${kpis
          .map(
            (k) => `
          <div class="insight-kpi">
            <div class="insight-kpi__label">${k.label}</div>
            <div class="insight-kpi__value">${k.value}</div>
            <div class="insight-kpi__sub">${k.sub}</div>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="insights-section-title">Top ${exhibitWordPlural} לפי צפיות</div>
      <div class="insight-table">
        ${topRows || `<div class="small">אין נתוני צפיות בטווח שנבחר.</div>`}
      </div>
    `;
  }

  async function loadAnalyticsInsights(map, rangeDays = 30) {
    const insightsEl = document.getElementById("analyticsInsights");
    if (!insightsEl) return;

    try {
      const qs = buildQuery({ rangeDays });
      const url = qs
        ? `/.netlify/functions/analytics-report?${qs}`
        : `/.netlify/functions/analytics-report?rangeDays=${encodeURIComponent(rangeDays)}`;

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`analytics report http ${res.status}`);

      const json = await res.json();
      renderAnalyticsInsights(insightsEl, json, map);
    } catch (e) {
      console.log("analytics insights error:", e);
      trackGaError(gaCtx, "analytics_report_failed", { status: String(e?.message || "") });
      insightsEl.innerHTML = `<div class="small">לא ניתן לטעון תובנות כרגע.</div>`;
    }
  }

  await loadUsageBreakdown(exhibitsMap);

  const rangeEl = document.getElementById("analyticsRangeDays");
  const initialRange = Number(rangeEl?.value || 30);
  await loadAnalyticsInsights(exhibitsMap, initialRange);

  rangeEl?.addEventListener("change", async () => {
    const nextRange = Number(rangeEl.value || 30);
    await loadAnalyticsInsights(exhibitsMap, nextRange);
  });
})();
