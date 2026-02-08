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
    exhibitSummary
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
- אם נשאלת שאלה על היוצר/ת (למשל "ספר לי על היוצרת" / "מי זו ..."):
  - אם יש creatorBio: הצג/י 1–3 משפטים שמבוססים רק על creatorBio (אפשר לצטט או לסכם), והוסף/י בסוף משפט קצר:
    "מעבר לזה אין לי מידע ביוגרפי נוסף מתוך המידע שיש לי."
  - אם creatorBio ריק: אמור/י "היוצרת של המיצג היא <creatorName>. אין לי מידע ביוגרפי נוסף מתוך המידע שיש לי."
  - אל תענה/י "אין מידע ביוגרפי נוסף" אם creatorBio קיים.

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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2
      })
    });

    const openaiJson = await openaiRes.json();

    if (!openaiRes.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: "OpenAI error", details: openaiJson }) };
    }

    const answer = extractText(openaiJson) || "אין לי מספיק מידע על זה מתוך המידע שיש לי על המיצג.";

    return {
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ answer })

};

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(err) }) };
  }
};

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
function limitChars(text, maxChars){
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trim() + "…";
}
