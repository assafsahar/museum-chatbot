(async function () {
  const params = new URLSearchParams(location.search);
  const exhibitId = params.get("id") || "exhibit-01";
  const debugMode = params.get("debug") === "1";
  const mockMode = params.get("mock") === "1";

    // Keep current exhibit data for mock answers
    let currentData = null;
    let currentExhibit = null;


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
    micBtn: document.getElementById("micBtn"),
    resetBtn: document.getElementById("resetBtn")
  };

    // --- Text-to-Speech (play button per assistant message) ---

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
  scrollChatLogToBottom();

  return row;
}
function scrollChatLogToBottom() {
  if (!els.chatLog) return;
  requestAnimationFrame(() => {
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  });
}

  
function smoothScrollToY(targetY, durationMs = 520) {
  const startY = window.scrollY || window.pageYOffset;
  const deltaY = targetY - startY;

  // If the distance is tiny, still animate a bit so it feels like movement
  const minDistance = 120;
  const effectiveDelta = Math.abs(deltaY) < minDistance
    ? (deltaY >= 0 ? minDistance : -minDistance)
    : deltaY;

  const finalY = startY + effectiveDelta;
  const startT = performance.now();

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    const t = Math.min(1, (now - startT) / durationMs);
    const eased = easeInOutCubic(t);
    window.scrollTo(0, startY + effectiveDelta * eased);
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

  function scrollChatIntoViewIfMobile() {
  if (!window.matchMedia("(max-width: 900px)").matches) return;

  // Scroll to the input area (so user can keep typing immediately)
  const inputEl = els.q || document.getElementById("q");
  if (!inputEl) return;

  requestAnimationFrame(() => {
    const rect = inputEl.getBoundingClientRect();

    // Put the input comfortably above the bottom (for on-screen keyboard)
    const bottomPadding = 16;
    const targetY =
      (window.scrollY || window.pageYOffset) +
      rect.bottom -
      window.innerHeight +
      bottomPadding;

    smoothScrollToY(targetY, 520);
  });
}


  // --- Voice input (Speech-to-Text) ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;

  function setupVoiceInput() {
    if (!els.micBtn) return;

    if (!SpeechRecognition) {
      // Hide mic button if not supported (e.g. Safari iOS in many cases)
      els.micBtn.style.display = "none";
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "he-IL";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isRecording = true;
      els.micBtn.classList.add("recording");
    };

    recognition.onend = () => {
      isRecording = false;
      els.micBtn.classList.remove("recording");
    };

    recognition.onerror = () => {
      isRecording = false;
      els.micBtn.classList.remove("recording");
      appendMessage("assistant", "לא הצלחתי לשמוע. נסה/י שוב.");
    };

    recognition.onresult = async (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;

      els.q.value = text;
      await onSend(); // send exactly like typed text
    };

    els.micBtn.addEventListener("click", () => {
      if (!recognition) return;

      if (isRecording) {
        recognition.stop();
        return;
      }

      els.q.value = "";
      recognition.start();
    });
  }


  // --- Quick buttons -> guaranteed server fast paths (saves credits) ---
  function tagToCommand(tag) {
    const t = String(tag || "").trim();

    if (t === "טכניקות") return "__FACT:טכניקות__";
    if (t === "חומרים") return "__FACT:חומרים__";
    if (t === "שנת יצירה") return "__FACT:שנת יצירה__";
    if (t === "אוצר/ת") return "__FACT:אוצר/ת__";
    if (t === "מי היוצר/ת") return "מי היוצר/ת";
    if (t === "תקציר קצר") return "__SUMMARY__";

    // fallback: if you keep legacy tags like "הקשר" / "תנועה" etc,
    // we send a safe, generic question (may return "אין לי מספיק מידע" if not covered).
    return `ספר/י בקצרה על "${t}" כפי שמתואר במידע על המיצג.`;
  }

  function setTags(exhibit) {
    const tags = Array.isArray(exhibit?.tags) ? exhibit.tags : [];
    els.tags.innerHTML = "";

    // Only show buttons that we can answer reliably
    const allowed = new Set(["תקציר קצר", "טכניקות", "חומרים", "שנת יצירה", "אוצר/ת", "מי היוצר/ת"]);
    const filtered = tags.filter((t) => allowed.has(String(t).trim()));

    // If exhibit doesn't define tags, fallback to a default set
    const finalTags = filtered.length
      ? filtered
      : ["תקציר קצר", "טכניקות", "חומרים", "שנת יצירה", "מי היוצר/ת"];

    finalTags.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tagBtn";
      btn.textContent = t;

      btn.addEventListener("click", async () => {
    // Show as user-facing natural language
    appendMessage("user", t);
    scrollChatIntoViewIfMobile();


    // Default: server path
    const pending = appendMessage("assistant", "רגע…");
    const { answer } = await ask(tagToCommand(t));

    const bubble = pending?.querySelector(".bubble");
    if (bubble) bubble.textContent = answer;
    scrollChatLogToBottom();

    })


      els.tags.appendChild(btn);
    });
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

    const creatorImg = String(exhibit?.creatorImage || "").trim();
    const fallbackImg = "assets/creator-placeholder.jpg";

    els.creatorImg.src = creatorImg ? creatorImg : fallbackImg;
    els.creatorImg.alt = exhibit.creatorName || "יוצר/ת";
    els.creatorImg.style.display = "block";

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
    currentData = data;


    if (debugMode) {
      console.log("CLIENT DEBUG EXHIBITS:", data);
    }

    renderMuseum(data);

    const exhibit = data?.exhibits?.[exhibitId];
    currentExhibit = exhibit || null;

    if (!exhibit) {
      appendMessage("assistant", "לא מצאתי את המיצג הזה.");
      return;
    }

    els.title.textContent = exhibit.title || "";
    els.subtitle.textContent = exhibit.subtitle || "";

    const exhibitHero = (exhibit.heroImage || "").trim();
    const exhibitionHero = (data?.museum?.exhibitionImage || "").trim();
    const heroSrc = exhibitHero || exhibitionHero;

    if (heroSrc) {
        els.heroImg.src = heroSrc;
        els.heroImg.alt = exhibit.title || "תמונה";
    }


    renderCreator(exhibit);
    setTags(exhibit); // changed: pass exhibit instead of tags array
    renderDescription(exhibit);
    renderVideo(exhibit);

    // Initial greeting (aligned with available buttons)
    appendMessage(
      "assistant",
      "שלום 🙂 אפשר לשאול אותי שאלות על המיצג, או להשתמש בכפתורים למעלה לקבלת מידע מהיר."
    );
  }

  function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFactValue(exhibit, factKey) {
  const facts = Array.isArray(exhibit?.facts) ? exhibit.facts : [];
  const key = String(factKey || "").trim();

  // facts are like "חומרים: ...", "טכניקות: ..."
  const found = facts.find((f) => String(f).trim().startsWith(key + ":"));
  if (!found) return null;

  return String(found).split(":").slice(1).join(":").trim();
}

function mockAnswer(question) {
  const qRaw = String(question || "").trim();
  const q = qRaw.replace(/[?？！]/g, "").trim(); // normalize
  const qLower = q.toLowerCase();
  const ex = currentExhibit;
  const museum = currentData?.museum || {};

  if (!ex) return "מצב הדגמה: לא נמצא מיצג.";

  // --- Exhibition (museum) questions ---
  if (
    qLower.includes("מהי התערוכה") ||
    qLower.includes("מה התערוכה") ||
    qLower.includes("על מה התערוכה") ||
    qLower.includes("ספר לי על התערוכה") ||
    qLower.includes("ספרי לי על התערוכה")
  ) {
    const title = museum.exhibitionTitle || "התערוכה";
    const summary = museum.exhibitionSummary || "אין לי תקציר לתערוכה במצב הדגמה.";
    return `${title}\n\n${summary}`;
  }

  // --- Fast paths (tokens that buttons send) ---
  if (qRaw.startsWith("__FACT:") && qRaw.endsWith("__")) {
    const key = qRaw.replace("__FACT:", "").replace("__", "").trim();
    const val = getFactValue(ex, key);
    return val ? `${key}: ${val}` : `אין לי מידע על ${key}.`;
  }

  if (qRaw === "__SUMMARY__" || qLower === "תקציר קצר" || qLower.includes("תקציר")) {
    const text = stripHtml(ex.exhibitDescriptionHtml);
    const firstSentence = text.split(".")[0]?.trim();
    return firstSentence ? firstSentence + "." : "אין לי מספיק מידע לתקציר קצר.";
  }

  // --- Creator questions ---
  if (
    qLower.includes("מי היוצר") ||
    qLower.includes("מי היוצרת") ||
    qLower.includes("מי יצר") ||
    qLower.includes("מי יצרה")
  ) {
    const name = ex.creatorName || "לא מצוין";
    const bio = ex.creatorBio ? `\n\n${ex.creatorBio}` : "";
    return `${name}${bio}`;
  }

  // --- Facts asked as free text ---
  if (qLower.includes("טכניק")) {
    const val = getFactValue(ex, "טכניקות");
    return val ? `טכניקות: ${val}` : "אין לי מידע על טכניקות.";
  }

  if (qLower.includes("חומר")) {
    const val = getFactValue(ex, "חומרים");
    return val ? `חומרים: ${val}` : "אין לי מידע על חומרים.";
  }

  if (qLower.includes("שנת")) {
    const val = getFactValue(ex, "שנת יצירה");
    return val ? `שנת יצירה: ${val}` : "אין לי מידע על שנת יצירה.";
  }

  if (qLower.includes("אוצר")) {
    const val = getFactValue(ex, "אוצר/ת");
    return val ? `אוצר/ת: ${val}` : "אין לי מידע על אוצר/ת.";
  }

  // --- Fallback: echo the question + show a short snippet (so it feels different) ---
  const desc = stripHtml(ex.exhibitDescriptionHtml);
  const short = desc ? desc.slice(0, 220) + (desc.length > 220 ? "…" : "") : "";
  return `מצב הדגמה: עדיין לא פניתי לשרת.\n\nשאלת: "${qRaw}"\n\nמידע זמין מקומי:\n${short || "אין תיאור זמין."}`;
}


  async function ask(question) {
    if (mockMode) {
        return { answer: mockAnswer(question), debug: { mock: true } };
    }

    const url = debugMode
      ? "/.netlify/functions/chat?debug=1"
      : "/.netlify/functions/chat";

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exhibitId, question })
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
    scrollChatIntoViewIfMobile();

    // temporary "typing" bubble
    const pending = appendMessage("assistant", "רגע…");

    const { answer } = await ask(q);

    // replace typing bubble text
    const bubble = pending?.querySelector(".bubble");
    if (bubble) bubble.textContent = answer;
    scrollChatLogToBottom();


  }

  function onReset() {
    els.chatLog.innerHTML = "";
    appendMessage(
      "assistant",
      "איפסתי 🙂 אפשר לשאול שוב, או להשתמש בכפתורים למעלה."
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

  setupVoiceInput(); 
  await loadExhibit();
})();
