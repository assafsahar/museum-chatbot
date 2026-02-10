export function getEls() {
  return {
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

    chatWrap: document.getElementById("chatWrap") || document.querySelector(".chat-wrap"),
    chatLog: document.getElementById("chatLog"),
    q: document.getElementById("q"),
    sendBtn: document.getElementById("sendBtn"),
    micBtn: document.getElementById("micBtn"),
    resetBtn: document.getElementById("resetBtn"),
  };
}

export function isMobile() {
  return window.matchMedia("(max-width: 900px)").matches;
}

export function scrollChatLogToBottom(chatLog) {
  if (!chatLog) return;
  requestAnimationFrame(() => {
    chatLog.scrollTop = chatLog.scrollHeight;
  });
}

export function smoothScrollToY(targetY, durationMs = 520) {
  const startY = window.scrollY || window.pageYOffset;
  const deltaY = targetY - startY;
  const startT = performance.now();

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    const t = Math.min(1, (now - startT) / durationMs);
    const eased = easeInOutCubic(t);
    window.scrollTo(0, startY + deltaY * eased);
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

export function ensureInputVisibleOnMobile(inputEl) {
  if (!isMobile()) return;
  if (!inputEl) return;

  requestAnimationFrame(() => {
    const rect = inputEl.getBoundingClientRect();
    const ok = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (ok) return;

    const bottomPadding = 16;
    const targetY =
      (window.scrollY || window.pageYOffset) +
      rect.bottom -
      window.innerHeight +
      bottomPadding;

    smoothScrollToY(targetY, 520);
  });
}
