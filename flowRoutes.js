import express from "express";

const router = express.Router();

/**
 * ENV (Render)
 * - FLOW_BASE_URL: default https://labs.google
 * - FLOW_AUTH_SESSION_URL: default https://labs.google/fx/api/auth/session
 * - FLOW_VEO_GENERATE_URL: default https://labs.google/fx/api/video/generate
 * - FLOW_VEO_STATUS_URL: default https://labs.google/fx/api/video/status
 */
const FLOW_BASE_URL = (process.env.FLOW_BASE_URL || "https://labs.google").replace(/\/+$/, "");

const FLOW_AUTH_SESSION_URL =
  process.env.FLOW_AUTH_SESSION_URL || `${FLOW_BASE_URL}/fx/api/auth/session`;

const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || `${FLOW_BASE_URL}/fx/api/video/generate`;

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || `${FLOW_BASE_URL}/fx/api/video/status`;

// ---------------- helpers ----------------
function mask(s) {
  if (!s) return "";
  const str = String(s);
  return str.length <= 10 ? "***" : `${str.slice(0, 4)}...${str.slice(-4)}`;
}

function tryParseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractToken(req) {
  // 1) Authorization header
  const auth = req.headers.authorization || "";
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  // 2) body.access_token / body.token
  if (req.body?.access_token) return String(req.body.access_token).trim();
  if (req.body?.token) return String(req.body.token).trim();

  // 3) body is a JSON string (some UIs store the whole JSON session as string)
  // e.g. "{ "access_token":"ya29....", "expires":"..." }"
  const parsed = tryParseJson(req.body);
  if (parsed?.access_token) return String(parsed.access_token).trim();

  // 4) body.sessionJson / body.flowKey / etc (fallbacks)
  const candidates = [req.body?.sessionJson, req.body?.flowKey, req.body?.key, req.body?.value];
  for (const c of candidates) {
    const p = tryParseJson(c);
    if (p?.access_token) return String(p.access_token).trim();
  }

  return "";
}

function jsonOrText(text) {
  try {
    return { json: JSON.parse(text), text: null };
  } catch {
    return { json: null, text };
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    const raw = await r.text();
    return { r, raw };
  } finally {
    clearTimeout(t);
  }
}

function commonHeaders(token) {
  return {
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${token}`,
    // “Origin/Referer” đôi khi giúp upstream dễ accept hơn
    Origin: FLOW_BASE_URL,
    Referer: `${FLOW_BASE_URL}/fx/`,
  };
}

// Preflight
router.options("*", (req, res) => res.sendStatus(204));

// ---------------- routes ----------------

/**
 * GET /api/flow/health (optional)
 */
router.get("/health", (req, res) => {
  res.json({ ok: true, service: "flow-backend", base: FLOW_BASE_URL });
});

/**
 * POST /api/flow/session/validate
 * Body: can be {access_token:"..."} OR a JSON string {"access_token":"...","expires":"..."}
 */
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(400).json({
      ok: false,
      error: "Missing token. Provide Authorization: Bearer <access_token> OR JSON body {access_token:'...'}",
    });
  }

  const upstream = FLOW_AUTH_SESSION_URL;
  console.log("[FLOW] validate ->", upstream, "bearer:", mask(token));

  try {
    const { r, raw } = await fetchWithTimeout(
      upstream,
      { method: "GET", headers: commonHeaders(token) },
      45000
    );

    const parsed = jsonOrText(raw);

    return res.status(r.status).json({
      ok: r.ok,
      upstream,
      upstreamStatus: r.status,
      upstreamBody: parsed.json ?? parsed.text ?? null,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      upstream,
      upstreamStatus: 0,
      upstreamBody: null,
      error: String(e),
    });
  }
});

/**
 * POST /api/flow/video/generate
 * POST /api/flow/veo/generate   (alias for compatibility)
 */
async function handleGenerate(req, res) {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing token (access_token)" });

  const upstream = FLOW_VEO_GENERATE_URL;

  // forward body but remove secrets
  let forwardBody = req.body;

  // if body is string JSON, parse it
  const parsedBody = tryParseJson(req.body);
  if (parsedBody && typeof parsedBody === "object") forwardBody = parsedBody;

  if (!forwardBody || typeof forwardBody !== "object") forwardBody = {};
  delete forwardBody.access_token;
  delete forwardBody.token;

  console.log("[FLOW] generate ->", upstream, "bearer:", mask(token));

  try {
    const { r, raw } = await fetchWithTimeout(
      upstream,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...commonHeaders(token) },
        body: JSON.stringify(forwardBody),
      },
      90000
    );

    const parsed = jsonOrText(raw);

    return res.status(r.status).json({
      ok: r.ok,
      upstream,
      upstreamStatus: r.status,
      upstreamBody: parsed.json ?? parsed.text ?? null,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      upstream,
      upstreamStatus: 0,
      upstreamBody: null,
      error: String(e),
    });
  }
}
router.post("/video/generate", handleGenerate);
router.post("/veo/generate", handleGenerate);

/**
 * GET /api/flow/video/status/:jobId
 * GET /api/flow/veo/status/:jobId    (alias)
 */
async function handleStatus(req, res) {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing token (access_token)" });

  const jobId = req.params.jobId;
  const base = String(FLOW_VEO_STATUS_URL).replace(/\/+$/, "");
  const upstream = `${base}/${encodeURIComponent(jobId)}`;

  console.log("[FLOW] status ->", upstream);

  try {
    const { r, raw } = await fetchWithTimeout(
      upstream,
      { method: "GET", headers: commonHeaders(token) },
      45000
    );

    const parsed = jsonOrText(raw);

    return res.status(r.status).json({
      ok: r.ok,
      upstream,
      upstreamStatus: r.status,
      upstreamBody: parsed.json ?? parsed.text ?? null,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      upstream,
      upstreamStatus: 0,
      upstreamBody: null,
      error: String(e),
    });
  }
}
router.get("/video/status/:jobId", handleStatus);
router.get("/veo/status/:jobId", handleStatus);

export default router;
