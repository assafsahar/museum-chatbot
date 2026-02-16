// assets/index.js
// Comments in English only

(async () => {
  const params = new URLSearchParams(location.search);

  // Tenant params
  const museumId = params.get("museum") || params.get("museumId") || null;
  const exhibitionId = params.get("exhibition") || params.get("exhibitionId") || null;

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
    return;
  }

  const exhibitionImg = document.getElementById("exhibitionImg");
  const exhibitionTitle = document.getElementById("exhibitionTitle");
  const exhibitionSummary = document.getElementById("exhibitionSummary");

  if (exhibitionTitle) exhibitionTitle.textContent = data.museum?.exhibitionTitle || "";
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

  try {
    const qs = buildQuery({});
    const url = qs ? `/.netlify/functions/usage?${qs}` : "/.netlify/functions/usage";

    const usageRes = await fetch(url, { cache: "no-store" });
    const usageJson = await usageRes.json();

    if (usageCountEl) usageCountEl.textContent = String(usageJson?.questionsTotal ?? 0);
    if (usageMonthEl) usageMonthEl.textContent = String(usageJson?.monthKey ?? "—");
  } catch {
    if (usageCountEl) usageCountEl.textContent = "—";
    if (usageMonthEl) usageMonthEl.textContent = "—";
  }

  // Usage breakdown (monthly per exhibit)
  function renderUsageBreakdown(container, items, map) {
    if (!container) return;

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="small">אין עדיין שימושים החודש לפי מיצגים.</div>`;
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
        <div class="usageHeader__title">מיצג</div>
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
      const breakdownEl = document.getElementById("usageBreakdown");
      if (breakdownEl) breakdownEl.innerHTML = `<div class="small">לא ניתן לטעון את ההתפלגות כרגע.</div>`;
    }
  }

  await loadUsageBreakdown(exhibitsMap);
})();
