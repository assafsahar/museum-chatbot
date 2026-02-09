(async function () {
  const params = new URLSearchParams(location.search);
  const exhibitId = params.get("id") || "exhibit-01";
  const debugMode = params.get("debug") === "1";

  // Match your HTML IDs exactly
  const els = {
    museumLogo: document.getElementById("museumLogo"),
    museumName: document.getElementById("museumName"),

    heroImg: document.getElementById("heroImg"),
    title: document.getElementById("title"),
    subtitle: document.getElementById("subtitle"),

    creatorBox: document.getElementById("creatorBox"),
    creatorImg: document.getElementById("creatorImg"),
    creatorText: document.getElementById("creatorText"),

    tags: document.getElementById("tags"),
    description: document.getElementById("description"),

    videoTitle: document.getElementById("videoTitle"),
    videoBox: document.getElementById("videoBox"),
    videoFrame: document.getElementById("videoFrame"),

    chatLog: document.getElementById("chatLog"),
    q: document.getElementById("q"),
    sendBtn: document.getElementById("sendBtn"),
    resetBtn: document.getElementById("resetBtn"),
  };

  function appendMessage(role, text) {
    // role: "user" | "assistant"
    const row = document.createElement("div");
    row.className = `msg ${role}`;

    const label = document.createElement("div");
    label.className = "msgLabel";
    label.textContent = role === "user" ? "מבקר" : "מדריך";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    row.appendChild(label);
    row.appendChild(bubble);

    els.chatLog.appendChild(row);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;

    return row;
  }

  function setTags(tags) {
    els.tags.innerHTML = "";

    (tags || []).forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tagBtn";
      btn.textContent = t;

      btn.addEventListener("click", () => {
        els.q.value = `מה המשמעות של "${t}"?`;
        onSend();
      });

      els.tags.appendChild(btn);
    });

    // Extra fixed button: "יוצר/ת"
    const creatorBtn = document.createElement("button");
    creatorBtn.type = "button";
    creatorBtn.className = "tagBtn";
    creatorBtn.textContent = "יוצר/ת";
    creatorBtn.addEventListener("click", () => {
      els.q.value = "ספר לי על היוצר/ת";
      onSend();
    });
    els.tags.appendChild(creatorBtn);
  }

  function renderDescription(exhibit) {
    // You have HTML in exhibitDescriptionHtml; render as HTML
    els.description.innerHTML = exhibit.exhibitDescriptionHtml || "";
  }

  function renderCreator(exhibit) {
    const hasCreatorName = !!exhibit.creatorName;
    const hasCreatorImage = !!exhibit.creatorImage;

    if (!hasCreatorName && !hasCreatorImage) {
      els.creatorBox.style.display = "none";
      return;
    }

    els.creatorBox.style.display = "flex";
    els.creatorText.textContent = exhibit.creatorName || "—";

    if (hasCreatorImage) {
      els.creatorImg.src = exhibit.creatorImage;
      els.creatorImg.alt = exhibit.creatorName || "יוצר/ת";
      els.creatorImg.style.display = "block";
    } else {
      els.creatorImg.style.display = "none";
    }
  }

  function renderVideo(exhibit) {
    const url = (exhibit.videoUrl || "").trim();
    if (!url) {
      els.videoTitle.style.display = "none";
      els.videoBox.style.display = "none";
      return;
    }

    els.videoTitle.style.display = "block";
    els.videoBox.style.display = "block";
    els.videoFrame.src = url; // assumes already embed-ready
  }

  function renderMuseum(data) {
    if (data?.museum?.logo) els.museumLogo.src = data.museum.logo;
    if (data?.museum?.name) els.museumName.textContent = data.museum.name;
  }

  async function loadExhibit() {
    const res = await fetch("assets/exhibits.json", { cache: "no-store" });
    const data = await res.json();

    if (debugMode) {
      console.log("CLIENT DEBUG RESPONSE:", data);
    }

    renderMuseum(data);

    const exhibit = data?.exhibits?.[exhibitId];
    if (!exhibit) {
      appendMessage("assistant", "לא מצאתי את המיצג הזה.");
      return;
    }

    els.title.textContent = exhibit.title || "";
    els.subtitle.textContent = exhibit.subtitle || "";

    if (exhibit.heroImage) {
      els.heroImg.src = exhibit.heroImage;
      els.heroImg.alt = exhibit.title || "תמונה של המיצג";
    }

    renderCreator(exhibit);
    setTags(exhibit.tags || []);
    renderDescription(exhibit);
    renderVideo(exhibit);

    // Initial greeting
    appendMessage(
      "assistant",
      "שלום 🙂 אפשר לשאול אותי שאלות על המיצג. למשל: \"מה הטכניקה?\", \"מה החומרים?\", \"מי היוצר/ת?\""
    );
  }

  async function ask(question) {
    const url = debugMode
      ? "/.netlify/functions/chat?debug=1"
      : "/.netlify/functions/chat";

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exhibitId, question }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json) {
      if (debugMode) console.log("CHAT DEBUG (error):", res.status, json);
      return { answer: "שגיאת רשת. נסה/י שוב.", debug: null };
    }

    if (debugMode) console.log("CHAT DEBUG RESPONSE:", json);

    return { answer: json.answer || "שגיאת רשת. נסה/י שוב.", debug: json.debug || null };
  }

  async function onSend() {
    const q = (els.q.value || "").trim();
    if (!q) return;

    els.q.value = "";
    appendMessage("user", q);

    // temporary "typing" bubble
    const pending = appendMessage("assistant", "רגע…");

    const { answer } = await ask(q);

    // replace typing bubble text
    const bubble = pending?.querySelector(".bubble");
    if (bubble) bubble.textContent = answer;
  }

  function onReset() {
    els.chatLog.innerHTML = "";
    appendMessage(
      "assistant",
      "איפסתי 🙂 אפשר לשאול שוב. למשל: \"מה הטכניקה?\", \"מה החומרים?\", \"מי היוצר/ת?\""
    );
  }

  // Wire events (your UI uses a button + textarea)
  els.sendBtn.addEventListener("click", onSend);

  els.q.addEventListener("keydown", (e) => {
    // Enter sends, Shift+Enter new line
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  els.resetBtn.addEventListener("click", onReset);

  await loadExhibit();
})();
