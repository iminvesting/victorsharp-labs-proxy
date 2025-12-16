import express from "express";

const router = express.Router();

/**
 * NOTE:
 * - This router is typically mounted at: app.use("/api/flow", flowRoutes)
 * - So routes here become:
 *   /api/flow/session/validate
 *   /api/flow/video/generate
 *   /api/flow/video/status/:jobId
 *
 * Compatibility aliases (for old FE calls):
 *   /api/flow/veo/generate
 *   /api/flow/veo/status/:jobId
 */

// -------------------- Upstream config --------------------
const FLOW_BASE_URL = (process.env.FLOW_BASE_URL || "https://labs.google").replace(/\/+$/, "");

// If you set these env vars on Render, they will override defaults.
// You already set:
//   FLOW_VEO_GENERATE_URL=https://labs.google/fx/api/video/generate
//   FLOW_VEO_STATUS_URL=https://labs.google/fx/api/video/status
const FLOW_AUTH_SESSION_URL =
  process.env.FLOW_AUTH_SESSION_URL || buildUpstream("/fx/api/auth/session");

const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || buildUpstream("/fx/api/video/generate");

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || buildUpstream("/fx/api/video/status");

// -------------------- Helpers --------------------
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
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, ms = 30000) {
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
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${token}`,
    Origin: FLOW_BASE_URL,
    Referer: `${FLOW_BASE_URL}/fx/`,
  };
}

function buildStatusUrl(jobId) {
  const tpl = String(FLOW_VEO_STATUS_URL || "").trim();
  // If status URL supports templating
  if (tpl.includes("{id}")) return tpl.replaceAll("{id}", encodeURIComponent(jobId));
  // If it’s a base URL, append /<id>
  return `${tpl.replace(/\/+$/, "")}/${encodeURIComponent(jobId)}`;
}

// -------------------- Core handlers --------------------
async function handleValidate(req, res) {
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
}

async function handleGenerate(req, res) {
  const token = getBearer(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing Bearer token or access_token" });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

  const upstream = FLOW_VEO_GENERATE_URL;

  console.log(
    "[FLOW] generate ->",
    upstream,
    "bearer:",
    mask(token),
    "promptLen:",
    String(prompt).length
  );

  // Forward body as-is (minus tokens)
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
      60000
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
}

async function handleStatus(req, res) {
  const token = getBearer(req);
  if (!token) return res.status(400).json({ ok: false, error: "Missing Bearer token or access_token" });

  const jobId = req.params.jobId;
  if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId" });

  const upstream = buildStatusUrl(jobId);
  console.log("[FLOW] status ->", upstream, "bearer:", mask(token));

  try {
    const { res: r, text } = await fetchWithTimeout(
      upstream,
      { method: "GET", headers: commonHeaders(token) },
      20000
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
}

// -------------------- Routes (new + backward compatible) --------------------

// Validate session (used by "CHECK AUTH")
router.post("/session/validate", handleValidate);

// New endpoints (recommended)
router.post("/video/generate", handleGenerate);
router.get("/video/status/:jobId", handleStatus);

// Backward compatible aliases (old webapp calls)
router.post("/veo/generate", handleGenerate);
router.get("/veo/status/:jobId", handleStatus);

export default router;
