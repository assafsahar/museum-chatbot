// assets/index.js
// Comments in English only

(async () => {
  // Load exhibition + exhibits list
  const res = await fetch("assets/exhibits.json", { cache: "no-store" });
  const data = await res.json();

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
      a.href = `exhibit.html?id=${encodeURIComponent(id)}`;
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
    const usageRes = await fetch("/.netlify/functions/usage", { cache: "no-store" });
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
      const res = await fetch("/.netlify/functions/usage?breakdown=1", { cache: "no-store" });
      if (!res.ok) throw new Error(`usage breakdown http ${res.status}`);

      const json = await res.json();
      const items = json?.exhibits || [];
      renderUsageBreakdown(breakdownEl, items, map);
    } catch (e) {
      console.log("usage breakdown error:", e);
      breakdownEl.innerHTML = `<div class="small">לא ניתן לטעון את ההתפלגות כרגע.</div>`;
    }
  }

  await loadUsageBreakdown(exhibitsMap);
})();
