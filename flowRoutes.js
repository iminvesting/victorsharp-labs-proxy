import express from "express";

const router = express.Router();

/**
 * ====== CONFIG ======
 * You can override these in Render Environment Variables:
 *
 * FLOW_BASE_URL                (default: https://labs.google)
 * FLOW_SESSION_VALIDATE_URL    (default: https://labs.google/fx/api/auth/session)
 * FLOW_VEO_GENERATE_URL        (default: https://labs.google/fx/api/video/generate)
 * FLOW_VEO_STATUS_URL          (default: https://labs.google/fx/api/video/status)
 *
 * Notes:
 * - Some upstream endpoints may require GET instead of POST (auth/session often behaves like that).
 * - This proxy tries to be flexible (supports token in header OR in JSON body).
 */

const stripTrailingSlash = (s) => String(s || "").replace(/\/+$/, "");

const FLOW_BASE_URL = stripTrailingSlash(process.env.FLOW_BASE_URL || "https://labs.google");

const SESSION_VALIDATE_URL =
  stripTrailingSlash(process.env.FLOW_SESSION_VALIDATE_URL) ||
  `${FLOW_BASE_URL}/fx/api/auth/session`;

const VEO_GENERATE_URL =
  stripTrailingSlash(process.env.FLOW_VEO_GENERATE_URL) ||
  `${FLOW_BASE_URL}/fx/api/video/generate`;

const VEO_STATUS_URL =
  stripTrailingSlash(process.env.FLOW_VEO_STATUS_URL) ||
  `${FLOW_BASE_URL}/fx/api/video/status`;

function pickBearer(req) {
  // 1) Authorization header: "Bearer xxx"
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth && String(auth).toLowerCase().startsWith("bearer ")) return String(auth);

  // 2) token inside body (UI often stores JSON like {access_token:"..."})
  const t =
    req.body?.access_token ||
    req.body?.token ||
    req.body?.session ||
    req.query?.access_token ||
    req.query?.token;

  if (t) return `Bearer ${t}`;
  return null;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function buildUpstreamHeaders(req, bearer, extra = {}) {
  // Keep it minimal and clean to avoid upstream rejecting weird headers
  const h = {
    Accept: "application/json, text/plain, */*",
    ...extra,
  };

  if (bearer) h.Authorization = bearer;

  // If client sends JSON, keep content-type
  const ct = req.headers["content-type"];
  if (ct) h["Content-Type"] = ct;

  return h;
}

router.get("/health", (req, res) => {
  res.json({ ok: true, service: "flow-backend" });
});

/**
 * ========== SESSION VALIDATE ==========
 * Client may call:
 *  - POST /api/flow/session/validate
 *
 * Upstream sometimes expects GET on /fx/api/auth/session.
 * So we force upstream method = GET (more stable), regardless of client method.
 */
router.all("/session/validate", async (req, res) => {
  const bearer = pickBearer(req);
  const upstream = SESSION_VALIDATE_URL;

  if (!bearer) {
    return res.status(400).json({
      ok: false,
      error: "Missing Flow session token. Provide Authorization: Bearer <token> or body.access_token",
      upstream,
    });
  }

  try {
    console.log("[FLOW] validate ->", upstream);

    const r = await fetch(upstream, {
      method: "GET",
      headers: buildUpstreamHeaders(req, bearer),
    });

    const text = await readText(r);
    const json = safeJsonParse(text);

    if (!r.ok) {
      return res.status(400).json({
        ok: false,
        error: "Session validate failed",
        upstream,
        upstreamStatus: r.status,
        upstreamBody: json ?? text?.slice(0, 2000) ?? "",
      });
    }

    return res.status(200).json(json ?? { ok: true });
  } catch (e) {
    console.error("[FLOW] validate error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
});

/**
 * ========== VIDEO GENERATE ==========
 * Supports BOTH:
 *  - POST /api/flow/video/generate   (new)
 *  - POST /api/flow/veo/generate     (legacy alias)
 *
 * Body is passed through as-is.
 */
async function handleGenerate(req, res) {
  const bearer = pickBearer(req);
  const upstream = VEO_GENERATE_URL;

  if (!bearer) {
    return res.status(400).json({
      ok: false,
      error: "Missing Flow session token. Provide Authorization: Bearer <token> or body.access_token",
      upstream,
    });
  }

  try {
    console.log("[FLOW] generate ->", upstream);

    const body =
      req.body && Object.keys(req.body).length
        ? JSON.stringify(req.body)
        : JSON.stringify({ prompt: req.body?.prompt || "" });

    const r = await fetch(upstream, {
      method: "POST",
      headers: buildUpstreamHeaders(req, bearer, { "Content-Type": "application/json" }),
      body,
    });

    const text = await readText(r);
    const json = safeJsonParse(text);

    if (!r.ok) {
      // If upstream returns HTML (common for 404), we still bubble it up cleanly
      return res.status(404).json({
        ok: false,
        error: "Create Job Failed",
        upstream,
        upstreamStatus: r.status,
        upstreamBody: json ?? text?.slice(0, 2000) ?? "",
      });
    }

    return res.status(200).json(json ?? { ok: true, raw: text });
  } catch (e) {
    console.error("[FLOW] generate error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
}

router.post("/video/generate", handleGenerate);
router.post("/veo/generate", handleGenerate);

/**
 * ========== VIDEO STATUS ==========
 * Supports BOTH:
 *  - GET /api/flow/video/status/:id
 *  - GET /api/flow/veo/status/:id
 *
 * Upstream we will call: `${FLOW_VEO_STATUS_URL}/${id}`
 */
async function handleStatus(req, res) {
  const bearer = pickBearer(req);
  const id = req.params.id;
  const upstream = `${VEO_STATUS_URL}/${encodeURIComponent(id)}`;

  if (!bearer) {
    return res.status(400).json({
      ok: false,
      error: "Missing Flow session token. Provide Authorization: Bearer <token> or body.access_token",
      upstream,
    });
  }

  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing operation/job id", upstream });
  }

  try {
    console.log("[FLOW] status ->", upstream);

    const r = await fetch(upstream, {
      method: "GET",
      headers: buildUpstreamHeaders(req, bearer),
    });

    const text = await readText(r);
    const json = safeJsonParse(text);

    if (!r.ok) {
      return res.status(404).json({
        ok: false,
        error: "Status check failed",
        upstream,
        upstreamStatus: r.status,
        upstreamBody: json ?? text?.slice(0, 2000) ?? "",
      });
    }

    return res.status(200).json(json ?? { ok: true, raw: text });
  } catch (e) {
    console.error("[FLOW] status error:", e);
    return res.status(502).json({ ok: false, error: String(e), upstream });
  }
}

router.get("/video/status/:id", handleStatus);
router.get("/veo/status/:id", handleStatus);

export default router;
