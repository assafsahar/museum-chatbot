exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing OPENAI_API_KEY" }) };
    }

    const { exhibitId, question } = JSON.parse(event.body || "{}");
    if (!exhibitId || !question) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing exhibitId or question" }) };
    }

    const origin = event.headers.origin || event.headers.referer || "";
    const baseUrl = origin ? new URL(origin).origin : null;
    if (!baseUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: "Cannot resolve origin" }) };
    }

    const exhibitsRes = await fetch(`${baseUrl}/assets/exhibits.json`, { cache: "no-store" });
    const exhibitsData = await exhibitsRes.json();

    const exhibit = exhibitsData?.exhibits?.[exhibitId];
    if (!exhibit) {
      return { statusCode: 404, body: JSON.stringify({ error: "Exhibit not found" }) };
    }

    // ===== Creator-only fast path (NO OpenAI call) =====
    if (isCreatorQuestion(question)) {
      const creatorName = String(exhibit.creatorName || "").trim();
      const creatorBio = String(exhibit.creatorBio || "").trim();

      const answer = buildCreatorAnswer(creatorName, creatorBio);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      };
    }
    // ================================================

    const exhibitionSummary = exhibitsData?.museum?.exhibitionSummary || "";
    const fullDesc = stripHtml(exhibit.exhibitDescriptionHtml || "");
    const exhibitSummary = limitChars(fullDesc, 1500);

    const context = {
      exhibitionSummary,
      creatorName: exhibit.creatorName || "",
      creatorBio: exhibit.creatorBio || "",
      title: exhibit.title,
      subtitle: exhibit.subtitle,
      tags: exhibit.tags,
      facts: exhibit.facts,
      curatorNotes: exhibit.curatorNotes,
      exhibitSummary,
    };

    const system = `
את/ה מדריך/ה אינטראקטיבי/ת שקט/ה במוזיאון.
חובה:
- לענות בעברית, בניסוח נעים ומכבד.
- לענות רק על בסיס המידע שמופיע ב-Context.
- אם אין מספיק מידע ב-Context כדי לענות: לומר בדיוק:
  "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג."
- לא להמציא עובדות, שמות, תאריכים, או פרטים שלא מופיעים ב-Context.
- לא להוסיף קישורים ולא להפנות לאינטרנט.
- תשובה קצרה (עד ~120 מילים), אלא אם המשתמש ביקש במפורש פירוט.
- השתמש/י במונחים "היצירה" / "המיצג" כשעונים על exhibitSummary.
- השתמש/י במונח "התערוכה" רק כשמתייחסים במפורש ל-exhibitionSummary.
- אל תערבב/י בין המושגים: אל תכתוב/י "התערוכה היא פרויקט גמר" אם המידע מופיע ב-exhibitSummary.
`;

    const userPrompt = `
Context (המידע היחיד שמותר להשתמש בו):
${JSON.stringify(context, null, 2)}

הנחיה:
- העדף/י לענות קודם על בסיס facts.
- אם צריך, השתמש/י ב-exhibitSummary וב-exhibitionSummary.
- אם לא מופיע מידע ב-Context: החזר/י את משפט "אין לי מספיק מידע..." בדיוק.

שאלת המבקר:
${question}
`;

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        input: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    const openaiJson = await openaiRes.json();

    if (!openaiRes.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: "OpenAI error", details: openaiJson }) };
    }

    const answer = extractText(openaiJson) || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(err) }) };
  }
};

function isCreatorQuestion(q) {
  const s = String(q || "").trim();
  if (!s) return false;

  // normalize common variants
  const normalized = s
    .replace(/\u05F3/g, "'")  // Hebrew geresh to '
    .replace(/\s+/g, " ");

  const patterns = [
    // "Who is the creator"
    /מי\s+היוצר(?:\/ת)?/i,
    /מי\s+היוצרת/i,
    /מי\s+היוצרים/i,

    // "Tell me about the creator" (with/without the /י form)
    /ספר(?:\/י)?\s+לי\s+על\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)/i,
    /ספר(?:\/י)?\s+לי\s+על\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)\s+של\s+המיצג/i,
    /ספר(?:\/י)?\s+לי\s+על\s+היוצר(?:\/ת)?\s+של\s+המיצג/i,

    // "About the creator"
    /על\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)/i,
    /אודות\s+(?:היוצר(?:\/ת)?|היוצרת|היוצרים|יוצר\/ת)/i,

    // bio
    /ביוגרפ/i,
  ];

  return patterns.some((p) => p.test(normalized));
}



function buildCreatorAnswer(creatorName, creatorBio) {
  const name = creatorName || "היוצר/ת";

  if (!creatorBio) {
    return `היוצרת של המיצג היא ${name}. אין לי מידע ביוגרפי נוסף מתוך המידע שיש לי.`;
  }

  const bio = limitChars(creatorBio, 450);
  const suffix = "מעבר לזה אין לי מידע ביוגרפי נוסף מתוך המידע שיש לי.";
  const sep = /[.!?״”"]\s*$/.test(bio) ? " " : ". ";

  // Only bio + suffix (no adding creatorName facts)
  return `${bio}${sep}${suffix}`;
}


function stripHtml(html) {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractText(openaiJson) {
  if (typeof openaiJson.output_text === "string") return openaiJson.output_text;

  const out = openaiJson.output || [];
  for (const item of out) {
    const content = item.content || [];
    for (const c of content) {
      if (c.type === "output_text" && typeof c.text === "string") return c.text;
      if (typeof c.text === "string") return c.text;
    }
  }
  return "";
}

function limitChars(text, maxChars) {
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trim() + "…";
}
