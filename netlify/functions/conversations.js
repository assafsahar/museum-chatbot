// netlify/functions/conversations.js
// Comments in English only

export async function handler(event) {
  try {
    if (event.httpMethod === "GET") {
      // TODO: Fetch conversations from DB
      // Return shape:
      // { conversations: [{ exhibitId, exhibitTitle, preview, messageCount, messages:[{role,text}] }] }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversations: [] }),
      };
    }

    if (event.httpMethod === "DELETE") {
      const body = JSON.parse(event.body || "{}");
      const scope = body.scope || "all";

      // TODO: Delete conversations from DB according to scope
      // Example: delete all rows in conversations table

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, scope }),
      };
    }

    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error" }),
    };
  }
}
