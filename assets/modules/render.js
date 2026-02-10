export function renderMuseum(els, data) {
  if (data?.museum?.logo && els.museumLogo) els.museumLogo.src = data.museum.logo;
  if (data?.museum?.name && els.museumName) els.museumName.textContent = data.museum.name;
}

export function renderHero(els, exhibit, data) {
  const exhibitHero = (exhibit?.heroImage || "").trim();
  const exhibitionHero = (data?.museum?.exhibitionImage || "").trim();
  const heroSrc = exhibitHero || exhibitionHero;

  if (!els.heroImg) return;

  if (heroSrc) {
    els.heroImg.src = heroSrc;
    els.heroImg.alt = exhibit?.title || "תמונה";
    els.heroImg.style.display = "block";
  } else {
    els.heroImg.style.display = "none";
  }
}

export function renderCreator(els, exhibit) {
  const hasName = !!String(exhibit?.creatorName || "").trim();
  const hasImage = !!String(exhibit?.creatorImage || "").trim();

  if (!hasName && !hasImage) {
    els.creatorBox.style.display = "none";
    return;
  }

  els.creatorBox.style.display = "flex";
  els.creatorText.textContent = exhibit.creatorName || "—";

  const fallbackImg = "assets/creator-placeholder.jpg";
  const creatorImg = String(exhibit.creatorImage || "").trim();

  els.creatorImg.src = creatorImg || fallbackImg;
  els.creatorImg.alt = exhibit.creatorName || "יוצר/ת";
}

export function renderDescription(els, exhibit) {
  els.description.innerHTML = exhibit?.exhibitDescriptionHtml || "";
}

export function renderVideo(els, exhibit) {
  const url = (exhibit?.videoUrl || "").trim();
  if (!url) {
    els.videoTitle.style.display = "none";
    els.videoBox.style.display = "none";
    els.videoFrame.src = "";
    return;
  }

  els.videoTitle.style.display = "block";
  els.videoBox.style.display = "block";
  els.videoFrame.src = url;
}

export function setTags(els, exhibit, onTagClicked) {
  const tags = Array.isArray(exhibit?.tags) ? exhibit.tags : [];
  els.tags.innerHTML = "";

  const allowed = new Set(["תקציר קצר", "טכניקות", "חומרים", "שנת יצירה", "אוצר/ת", "מי היוצר/ת"]);
  const filtered = tags.filter((t) => allowed.has(String(t).trim()));

  const finalTags = filtered.length
    ? filtered
    : ["תקציר קצר", "טכניקות", "חומרים", "שנת יצירה", "מי היוצר/ת"];

  finalTags.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tagBtn";
    btn.textContent = t;

    btn.addEventListener("click", () => onTagClicked(t));
    els.tags.appendChild(btn);
  });
}
