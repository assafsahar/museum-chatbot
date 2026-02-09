const state = {
  exhibitId: null,
  exhibit: null,
  museum: null
};

function qs(name){
  return new URLSearchParams(location.search).get(name);
}
function el(id){ return document.getElementById(id); }

function addMsg(role, text){
  const box = document.createElement("div");
  box.className = "msg " + (role === "user" ? "user" : "assistant");

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = role === "user" ? "מבקר" : "מדריך";

  const body = document.createElement("div");
  body.textContent = text;

  box.appendChild(meta);
  box.appendChild(body);
  el("chatLog").appendChild(box);
  el("chatLog").scrollTop = el("chatLog").scrollHeight;
}

function setTags(tags){
  const wrap = el("tags");
  wrap.innerHTML = "";

  (tags || []).forEach(label => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag";
    btn.style.cursor = "pointer";

    // Make it feel like a button, not just a pill
    btn.setAttribute("aria-label", `שאלה בנושא: ${label}`);
    btn.textContent = label;

    btn.addEventListener("click", () => {
      const question = tagToQuestion(label);
      el("q").value = question;
      el("q").focus();
    });

    wrap.appendChild(btn);
  });
}

function tagToQuestion(label){
  const normalized = String(label).trim();

  // Map known labels to good museum questions
  if (normalized === "טכניקה") return "באיזו טכניקה נוצר המיצג? אפשר לפרט?";
  if (normalized === "חומר") return "מאילו חומרים עשוי המיצג? ומה המשמעות של הבחירה בחומרים האלה?";
  if (normalized === "הקשר") return "מה ההקשר או הסיפור מאחורי המיצג? מה רצו להעביר בו?";
  if (normalized === "יוצר/ת") return "ספר/י לי על היוצר/ת של המיצג.";

  // Fallback for any other tag
  return `ספר/י לי עוד על "${normalized}" בהקשר של המיצג.`;
}


async function loadExhibit(){
  state.exhibitId = qs("id") || "exhibit-01";

  const res = await fetch("assets/exhibits.json", { cache: "no-store" });
  const data = await res.json();
  console.log("CLIENT DEBUG RESPONSE:", data);


  state.museum = data.museum || {};
  const exhibits = data.exhibits || {};
  state.exhibit = exhibits[state.exhibitId];
  if (data.debug) {
  addMsg("assistant", "DEBUG: " + JSON.stringify(data.debug, null, 2));
}


  if(!state.exhibit){
    addMsg("assistant", "לא נמצא מיצג. בדוק/י את הקישור של ה-QR.");
    return;
  }

  el("museumName").textContent = state.museum.name || "מוזיאון";
  el("museumLogo").src = state.museum.logo || "assets/logo.png";

  el("title").textContent = state.exhibit.title || "";
  el("subtitle").textContent = state.exhibit.subtitle || "";
  setTags(state.exhibit.tags);

  el("heroImg").src = state.exhibit.heroImage || "";
  el("description").innerHTML = state.exhibit.exhibitDescriptionHtml || "";


  if(state.exhibit.creatorImage || state.exhibit.creatorName){
    el("creatorBox").style.display = "flex";
    el("creatorImg").src = state.exhibit.creatorImage || "";
    el("creatorText").textContent = state.exhibit.creatorName || "";
  }

  if(state.exhibit.videoUrl){
    el("videoTitle").style.display = "block";
    el("videoBox").style.display = "block";
    el("videoFrame").src = state.exhibit.videoUrl;
  }

  addMsg("assistant", "שלום 🙂 אפשר לשאול אותי שאלות על המיצג, למשל: \"מה הטכניקה?\", \"מה החומרים?\", \"מי היוצרת?\" או \"מה הסיפור מאחורי היצירה?\"");

}

function wireUI(){
  el("sendBtn").addEventListener("click", async () => {
  const q = el("q").value.trim();
  if(!q) return;

  el("q").value = "";
  addMsg("user", q);

  // Optional: show a tiny "thinking" message
  const thinkingText = "חושב...";
  addMsg("assistant", thinkingText);

  try{
    const resp = await fetch("/.netlify/functions/chat", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        exhibitId: state.exhibitId,
        question: q
      })
    });

    const data = await resp.json();

    // Remove the last assistant message if it's the "thinking" one
    const chat = el("chatLog");
    const last = chat.lastElementChild;
    if(last && last.classList.contains("assistant")){
      // last message could be thinking
      chat.removeChild(last);
    }

    if(!resp.ok){
  addMsg("assistant", data?.error || "שגיאה. נסה/י שוב.");
  return;
}


    addMsg("assistant", data.answer || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.");

  }catch(e){
    const chat = el("chatLog");
    const last = chat.lastElementChild;
    if(last && last.classList.contains("assistant")){
      chat.removeChild(last);
    }
    addMsg("assistant", "שגיאת רשת. נסה/י שוב.");
  }
});



  el("resetBtn").addEventListener("click", () => {
    el("chatLog").innerHTML = "";
    addMsg("assistant", "איפוס בוצע. שאל/י שוב 🙂");
  });

  el("q").addEventListener("keydown", (ev) => {
    if(ev.key === "Enter" && !ev.shiftKey){
      ev.preventDefault();
      el("sendBtn").click();
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  await loadExhibit();
  wireUI();
});
