// flowRoutes.js (ESM)
import express from "express";

const router = express.Router();

// Endpoint Google Labs
const LABS_SESSION_URL = "https://labs.google/fx/api/auth/session";

// -----------------------------
// Helpers
// -----------------------------
function isJsonLikeString(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))
  );
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
 * - string token (ya29....) OR "Bearer ya29..."
 * - JSON string ( {"access_token":"..."} or {"token":"..."} or any object)
 * - object
 */
function normalizeSessionInput(body) {
  let raw = body;

  // preferred: { session: ... }
  if (raw && typeof raw === "object" && raw.session !== undefined) raw = raw.session;

  // if string json -> parse
  if (isJsonLikeString(raw)) {
    const parsed = safeJsonParse(raw);
    if (parsed !== null) raw = parsed;
  }

  let token = null;

  if (typeof raw === "string") {
    const t = raw.trim();
    // allow user paste "Bearer xxx"
    token = t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
  }

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

async function readUpstream(resp) {
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return {
    status: resp.status,
    ok: resp.ok,
    contentType: resp.headers.get("content-type") || "",
    // keep short snippet for debugging
    textSnippet: text?.slice(0, 500),
    data,
  };
}

async function fetchWithTimeout(url, init, timeoutMs = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Multi-strategy:
 * 1) GET with Authorization Bearer <token>  (thường đúng nhất để đọc session hiện tại)
 * 2) POST empty body + Authorization (fallback)
 * 3) POST JSON {session: raw} (last resort - một số proxy custom dùng kiểu này)
 */
async function forwardToLabsSession({ raw, token }) {
  const headersBase = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "victorsharp-labs-proxy/1.0",
  };

  const authHeaders =
    typeof token === "string" && token.length > 20
      ? { Authorization: `Bearer ${token}` }
      : {};

  const attempts = [];

  // Strategy 1: GET + Bearer
  try {
    const resp = await fetchWithTimeout(
      LABS_SESSION_URL,
      {
        method: "GET",
        headers: { ...headersBase, ...authHeaders },
      },
      25000
    );
    const out = await readUpstream(resp);
    attempts.push({ strategy: "GET_BEARER", ...out });
    if (out.ok) return { picked: "GET_BEARER", out, attempts };
  } catch (e) {
    attempts.push({
      strategy: "GET_BEARER",
      ok: false,
      status: 0,
      error: e?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : (e?.message || String(e)),
    });
  }

  // Strategy 2: POST (no body) + Bearer
  try {
    const resp = await fetchWithTimeout(
      LABS_SESSION_URL,
      {
        method: "POST",
        headers: {
          ...headersBase,
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
      25000
    );
    const out = await readUpstream(resp);
    attempts.push({ strategy: "POST_EMPTY_JSON", ...out });
    if (out.ok) return { picked: "POST_EMPTY_JSON", out, attempts };
  } catch (e) {
    attempts.push({
      strategy: "POST_EMPTY_JSON",
      ok: false,
      status: 0,
      error: e?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : (e?.message || String(e)),
    });
  }

  // Strategy 3: POST {session: raw} (last resort)
  try {
    const resp = await fetchWithTimeout(
      LABS_SESSION_URL,
      {
        method: "POST",
        headers: {
          ...headersBase,
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session: raw }),
      },
      25000
    );
    const out = await readUpstream(resp);
    attempts.push({ strategy: "POST_SESSION_WRAPPER", ...out });
    return { picked: "POST_SESSION_WRAPPER", out, attempts };
  } catch (e) {
    attempts.push({
      strategy: "POST_SESSION_WRAPPER",
      ok: false,
      status: 0,
      error: e?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : (e?.message || String(e)),
    });
    return { picked: "POST_SESSION_WRAPPER", out: null, attempts };
  }
}

// -----------------------------
// Routes
// -----------------------------
router.get("/health", (_req, res) => {
  res.json({ ok: true, scope: "flow", ts: Date.now() });
});

router.get("/session/validate", (_req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body { session: <token or json> }",
  });
});

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

    const result = await forwardToLabsSession(normalized);

    // If we got an upstream response, pass-through its status
    if (result?.out) {
      const upstream = result.out;

      return res.status(upstream.status).json({
        ok: upstream.ok,
        upstreamStatus: upstream.status,
        picked: result.picked,
        // if JSON, return json; else return snippet
        data: upstream.data ?? { raw: upstream.textSnippet },
        debug: {
          attempts: result.attempts,
        },
      });
    }

    // No upstream response (network/timeout)
    return res.status(502).json({
      ok: false,
      error: "Bad Gateway",
      message: "No upstream response",
      debug: { attempts: result?.attempts || [] },
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
