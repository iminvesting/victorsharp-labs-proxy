// flowRoutes.js (ESM)

import express from "express";

const router = express.Router();

// Google Labs endpoint bạn đang forward tới
const LABS_SESSION_URL = "https://labs.google/fx/api/auth/session";

// -----------------------------
// Helpers
// -----------------------------
function isJsonLikeString(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Accepts:
 * - string token (ya29....)
 * - JSON string ( {"access_token":"..."} or {"token":"..."} or any object)
 * - object
 */
function normalizeSessionInput(input) {
  let raw = input;

  // If body is like { session: "...." } ok. If missing, raw may be entire body.
  if (raw && typeof raw === "object" && raw.session !== undefined) raw = raw.session;

  // If it's a JSON string, parse it
  if (isJsonLikeString(raw)) {
    const parsed = safeJsonParse(raw);
    if (parsed !== null) raw = parsed;
  }

  // Extract a token if possible
  let token = null;
  if (typeof raw === "string") token = raw.trim();
  if (raw && typeof raw === "object") {
    token =
      raw.access_token ||
      raw.token ||
      raw.session ||
      raw.value ||
      null;
  }

  return { raw, token };
}

async function forwardToLabsSession({ raw, token }) {
  // Strategy A: POST JSON body (most stable for proxies)
  // We send { session: <raw> } even if raw is object or string.
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
  };

  // If token looks like oauth token, also attach Authorization (harmless if ignored)
  if (typeof token === "string" && token.length > 20) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(LABS_SESSION_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ session: raw }),
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { status: resp.status, ok: resp.ok, data };
}

// -----------------------------
// Routes
// -----------------------------

// Optional: quick ping for this router
router.get("/health", (_req, res) => {
  res.json({ ok: true, scope: "flow", ts: Date.now() });
});

// IMPORTANT: your browser GET should show Method Not Allowed (expected)
router.get("/session/validate", (_req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body { session: <token or json> }",
  });
});

// This is what your WebApp should call
router.post("/session/validate", async (req, res) => {
  try {
    const normalized = normalizeSessionInput(req.body);

    if (!normalized.raw) {
      return res.status(400).json({
        ok: false,
        error: "Missing session",
        hint: "POST JSON: { session: <token or json> }",
      });
    }

    console.log("[FLOW_VALIDATE] ->", LABS_SESSION_URL);

    const out = await forwardToLabsSession(normalized);

    // Pass-through status, but keep a consistent wrapper
    return res.status(out.status).json({
      ok: out.ok,
      upstreamStatus: out.status,
      data: out.data,
    });
  } catch (e) {
    console.error("[FLOW_VALIDATE_ERROR]", e);
    return res.status(500).json({
      ok: false,
      error: "Validate failed",
      message: e?.message || String(e),
    });
  }
});

export default router;
