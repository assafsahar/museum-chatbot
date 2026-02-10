(async () => {
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

  museumName.textContent = data.museum?.name || "מוזיאון";
  museumLogo.src = data.museum?.logo || "assets/logo.png";

  const exhibits = data.exhibits || {};

  Object.entries(exhibits).forEach(([id, ex]) => {
    const row = document.createElement("div");
    row.className = "exhibitRow";

    const a = document.createElement("a");
    a.href = `exhibit.html?id=${encodeURIComponent(id)}`;
    a.className = "exhibitLink";
    a.innerHTML = `<b>${ex.title}</b><div class="small">${ex.subtitle || ""}</div>`;

    row.appendChild(a);
    list.appendChild(row);
  });
})();
