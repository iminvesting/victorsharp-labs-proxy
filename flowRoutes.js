// flowRoutes.js (ESM) — VictorSharp Flow Veo3 Proxy Routes
// Supports:
//   POST /api/flow/session/validate
//   POST /api/flow/veo/generate      + /api/flow/video/generate
//   GET  /api/flow/veo/status/:id    + /api/flow/video/status/:id
//
// Node 18+ has global fetch (Render Node 22+ OK)

import express from "express";

const router = express.Router();

/** =========================
 *  Upstream config (override via Render ENV)
 *  ========================= */
const FLOW_BASE_URL = (process.env.FLOW_BASE_URL || "https://labs.google").replace(/\/+$/, "");

// Session validate endpoint (GET)
const FLOW_SESSION_VALIDATE_URL =
  (process.env.FLOW_SESSION_VALIDATE_URL || `${FLOW_BASE_URL}/fx/api/auth/session`).replace(/\/+$/, "");

// Generate endpoint (POST)
const FLOW_VEO_GENERATE_URL =
  (process.env.FLOW_VEO_GENERATE_URL || `${FLOW_BASE_URL}/fx/api/video/generate`).replace(/\/+$/, "");

// Status endpoint prefix (GET {prefix}/{id})
const FLOW_VEO_STATUS_URL =
  (process.env.FLOW_VEO_STATUS_URL || `${FLOW_BASE_URL}/fx/api/video/status`).replace(/\/+$/, "");

/** =========================
 * Helpers
 * ========================= */
function safeSnippet(v, max = 1200) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function pickBearer(req) {
  const auth = req.headers.authorization || "";
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.trim(); // keep "Bearer xxx"
  }
  // fallback: accept token in body for convenience
  const t = req.body?.access_token || req.body?.token || req.body?.session;
  if (t && typeof t === "string" && t.trim()) return `Bearer ${t.trim()}`;
  return "";
}

async function readUpstreamBody(resp) {
  const text = await resp.text();
  try {
    return { kind: "json", data: JSON.parse(text) };
  } catch {
    return { kind: "text", data: text };
  }
}

function log(tag, obj) {
  try {
    console.log(`[${tag}]`, JSON.stringify(obj));
  } catch {
    console.log(`[${tag}]`, obj);
  }
}

/** =========================
 * POST /api/flow/session/validate
 * Header: Authorization: Bearer <token>
 * ========================= */
router.post("/session/validate", async (req, res) => {
  const bearer = pickBearer(req);

  log("FLOW_VALIDATE", {
    path: req.path,
    hasAuth: !!bearer,
    upstream: FLOW_SESSION_VALIDATE_URL,
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  try {
    const upstreamRes = await fetch(FLOW_SESSION_VALIDATE_URL, {
      method: "GET",
      headers: {
        Authorization: bearer,
        Accept: "application/json,text/plain,*/*",
      },
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        ok: false,
        error: "Session validate failed",
        upstream: FLOW_SESSION_VALIDATE_URL,
        upstreamStatus: upstreamRes.status,
        upstreamBody: body.kind === "json" ? body.data : safeSnippet(body.data, 4000),
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: FLOW_SESSION_VALIDATE_URL,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Session validate failed (proxy fetch error)",
      upstream: FLOW_SESSION_VALIDATE_URL,
      detail: String(err?.message || err),
    });
  }
});

/** =========================
 * POST /api/flow/veo/generate  (alias: /video/generate)
 * Body: JSON payload from WebApp
 * ========================= */
async function handleGenerate(req, res) {
  const bearer = pickBearer(req);
  const payload = req.body || {};

  log("FLOW_GENERATE", {
    path: req.path,
    hasAuth: !!bearer,
    upstream: FLOW_VEO_GENERATE_URL,
    promptPreview: safeSnippet(payload?.prompt || "", 120),
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "Missing/invalid JSON body" });
  }

  try {
    const upstreamRes = await fetch(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json,text/plain,*/*",
      },
      body: JSON.stringify(payload),
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        ok: false,
        error: `Create Job Failed (${upstreamRes.status})`,
        upstream: FLOW_VEO_GENERATE_URL,
        upstreamStatus: upstreamRes.status,
        upstreamBody: body.kind === "json" ? body.data : safeSnippet(body.data, 4000),
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: FLOW_VEO_GENERATE_URL,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Flow generate failed (proxy fetch error)",
      upstream: FLOW_VEO_GENERATE_URL,
      detail: String(err?.message || err),
    });
  }
}

router.post("/veo/generate", handleGenerate);
router.post("/video/generate", handleGenerate);

/** =========================
 * GET /api/flow/veo/status/:id  (alias: /video/status/:id)
 * ========================= */
async function handleStatus(req, res) {
  const bearer = pickBearer(req);
  const id = req.params.id;

  const upstreamUrl = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(id)}`;

  log("FLOW_STATUS", {
    path: req.path,
    hasAuth: !!bearer,
    upstream: upstreamUrl,
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: bearer,
        Accept: "application/json,text/plain,*/*",
      },
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        ok: false,
        error: `Status Failed (${upstreamRes.status})`,
        upstream: upstreamUrl,
        upstreamStatus: upstreamRes.status,
        upstreamBody: body.kind === "json" ? body.data : safeSnippet(body.data, 4000),
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: upstreamUrl,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Flow status failed (proxy fetch error)",
      upstream: upstreamUrl,
      detail: String(err?.message || err),
    });
  }
}

router.get("/veo/status/:id", handleStatus);
router.get("/video/status/:id", handleStatus);

// Debug (optional)
router.get("/debug/env", (_req, res) => {
  res.json({
    ok: true,
    FLOW_BASE_URL,
    FLOW_SESSION_VALIDATE_URL,
    FLOW_VEO_GENERATE_URL,
    FLOW_VEO_STATUS_URL,
  });
});

export default router;
