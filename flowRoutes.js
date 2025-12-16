import express from "express";

// Node 18+ has global fetch. If you're on Node <18, install node-fetch and import it.
const router = express.Router();

/**
 * IMPORTANT:
 * You (AS) MUST confirm the exact official Flow upstream host + endpoints.
 * The paths below are placeholders designed to make the proxy structure correct.
 *
 * Set FLOW_BASE_URL to the real upstream host (example: https://labs.google).
 */
const FLOW_BASE_URL = (process.env.FLOW_BASE_URL || "https://labs.google").replace(/\/+$/, "");

// Upstream endpoints (override via Render Environment variables)
// Default paths match current Flow UI calls (avoid the old /fx/api/veo/* paths which return 404 HTML).
const FLOW_AUTH_SESSION_URL = process.env.FLOW_AUTH_SESSION_URL || buildUpstream("/fx/api/auth/session");
const FLOW_VEO_GENERATE_URL = process.env.FLOW_VEO_GENERATE_URL || buildUpstream("/fx/api/video/generate");
const FLOW_VEO_STATUS_URL = process.env.FLOW_VEO_STATUS_URL || buildUpstream("/fx/api/video/status");

// ---------- helpers ----------
function buildUpstream(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${FLOW_BASE_URL}${p}`;
}

function mask(s) {
  if (!s) return "";
  const str = String(s);
  return str.length <= 10 ? "***" : `${str.slice(0, 4)}...${str.slice(-4)}`;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function fetchWithTimeout(url, options = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(t);
  }
}

function getBearer(req) {
  const auth = req.headers.authorization || "";
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const token = req.body?.access_token || req.body?.token;
  return token ? String(token).trim() : "";
}

function commonHeaders(token) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Authorization": `Bearer ${token}`,
    // Some upstreams enforce these:
    "Origin": FLOW_BASE_URL,
    "Referer": `${FLOW_BASE_URL}/fx/`,
  };
}

// ---------- routes ----------

/**
 * POST /api/flow/session/validate
 * Body: { access_token?, expires? }
 * Header: Authorization: Bearer <token> (preferred)
 */
router.post("/session/validate", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing Bearer token or access_token" });

  const upstream = FLOW_AUTH_SESSION_URL;

  console.log("[FLOW] validate ->", upstream, "bearer:", mask(token));

  try {
    const { res: r, text } = await fetchWithTimeout(
      upstream,
      { method: "GET", headers: commonHeaders(token) },
      15000
    );

    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      upstream,
      body: safeJson(text),
      bodyPreview: text.slice(0, 1200),
    });
  } catch (e) {
    console.error("[FLOW] validate error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
});

/**
 * POST /api/flow/video/generate
 * Body expected (flexible):
 * {
 *   prompt: string,
 *   image_base64?: string,
 *   aspectRatio?: string,
 *   durationSec?: number,
 *   model?: string,
 *   ...any
 * }
 */
router.post("/video/generate", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing Bearer token or access_token" });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

  // PLACEHOLDER: AS must confirm exact path for Veo3 generate endpoint.
  const upstream = FLOW_VEO_GENERATE_URL;

  console.log("[FLOW] generate ->", upstream, "bearer:", mask(token), "promptLen:", String(prompt).length);

  // Forward body as-is (minus tokens), so FE can evolve without BE changes
  const forwardBody = { ...req.body };
  delete forwardBody.access_token;
  delete forwardBody.token;

  try {
    const { res: r, text } = await fetchWithTimeout(
      upstream,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...commonHeaders(token) },
        body: JSON.stringify(forwardBody),
      },
      30000
    );

    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      upstream,
      body: safeJson(text),
      bodyPreview: text.slice(0, 2000),
    });
  } catch (e) {
    console.error("[FLOW] generate error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
});

/**
 * GET /api/flow/video/status/:jobId
 */
router.get("/video/status/:jobId", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing Bearer token or access_token" });

  const jobId = req.params.jobId;

  // PLACEHOLDER: AS must confirm exact status endpoint.
  // Status endpoint:
  // - If FLOW_VEO_STATUS_URL contains "{id}", we substitute it.
  // - Otherwise we append "/<id>" (works for operations base URL).
  const tpl = String(FLOW_VEO_STATUS_URL || "").trim();
  const upstream = tpl.includes("{id}")
    ? tpl.replaceAll("{id}", encodeURIComponent(jobId))
    : `${tpl.replace(/\/+$/, "")}/${encodeURIComponent(jobId)}`;

  console.log("[FLOW] status ->", upstream);

  try {
    const { res: r, text } = await fetchWithTimeout(
      upstream,
      { method: "GET", headers: commonHeaders(token) },
      15000
    );

    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      upstream,
      body: safeJson(text),
      bodyPreview: text.slice(0, 2000),
    });
  } catch (e) {
    console.error("[FLOW] status error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
});

/**
 * GET /api/flow/video/result/:jobId
 */
router.get("/video/result/:jobId", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing Bearer token or access_token" });

  const jobId = req.params.jobId;

  // PLACEHOLDER: AS must confirm exact result endpoint.
  const upstream = buildUpstream(`/fx/api/veo/result/${encodeURIComponent(jobId)}`);

  console.log("[FLOW] result ->", upstream);

  try {
    const { res: r, text } = await fetchWithTimeout(
      upstream,
      { method: "GET", headers: commonHeaders(token) },
      15000
    );

    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      upstream,
      body: safeJson(text),
      bodyPreview: text.slice(0, 2000),
    });
  } catch (e) {
    console.error("[FLOW] result error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
});

export default router;
