// flowRoutes.js (ESM)

import express from "express";

const router = express.Router();

// Helper: safe json response
function sendJson(res, status, data) {
  res.status(status).set("Content-Type", "application/json").send(JSON.stringify(data));
}

// Helper: normalize session payload
function normalizeSessionPayload(body) {
  // Accept:
  // - { session: "..." }
  // - { session: { ... } }
  // - { session: "{...json...}" }
  // - "raw string" (rare)
  if (!body) return null;

  if (typeof body === "string") return { session: body };

  if (typeof body === "object") {
    if ("session" in body) {
      const s = body.session;
      if (typeof s === "string") {
        const t = s.trim();
        if (t.startsWith("{") && t.endsWith("}")) {
          try {
            return { session: JSON.parse(t) };
          } catch {
            return { session: s };
          }
        }
        return { session: s };
      }
      return { session: s };
    }
    // if user posted raw object without {session:...}
    return { session: body };
  }

  return null;
}

// GET should return Method Not Allowed (your screenshot expects this)
router.get("/session/validate", (req, res) => {
  return sendJson(res, 405, {
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body { session: <token or json> }",
  });
});

// POST validate session → forward to Google Labs endpoint
router.post("/session/validate", async (req, res) => {
  try {
    const payload = normalizeSessionPayload(req.body);
    if (!payload || payload.session == null || payload.session === "") {
      return sendJson(res, 400, { ok: false, error: "Missing session in request body" });
    }

    const upstreamUrl = "https://labs.google/fx/api/auth/session";
    console.log(`[FLOW_VALIDATE] -> ${upstreamUrl}`);

    // Node 18+ has global fetch
    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json, text/plain, */*",
      },
      body: JSON.stringify(payload),
    });

    const text = await upstreamResp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstreamResp.ok) {
      return sendJson(res, upstreamResp.status, {
        ok: false,
        error: `Upstream error (${upstreamResp.status})`,
        data,
      });
    }

    return sendJson(res, 200, { ok: true, data });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e?.message || String(e) });
  }
});

export default router;
