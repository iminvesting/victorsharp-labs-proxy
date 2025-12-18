// flowRoutes.js (ESM)
// Routes:
//   GET/POST /api/flow/session/validate
//   POST     /api/flow/video/generate
//   GET      /api/flow/video/status/:id
//
// Upstream defaults can be overridden by Render ENV:
//   FLOW_BASE_URL
//   FLOW_SESSION_VALIDATE_URL
//   FLOW_VEO_GENERATE_URL
//   FLOW_VEO_STATUS_URL

import express from "express";

const router = express.Router();

const FLOW_BASE_URL = (process.env.FLOW_BASE_URL || "https://labs.google").replace(/\/+$/, "");

const FLOW_SESSION_VALIDATE_URL = (
  process.env.FLOW_SESSION_VALIDATE_URL || `${FLOW_BASE_URL}/fx/api/auth/session`
).replace(/\/+$/, "");

// NOTE: if Google changes endpoint, just override env FLOW_VEO_GENERATE_URL on Render
const FLOW_VEO_GENERATE_URL = (
  process.env.FLOW_VEO_GENERATE_URL || `${FLOW_BASE_URL}/fx/api/video/generate`
).replace(/\/+$/, "");

const FLOW_VEO_STATUS_URL = (
  process.env.FLOW_VEO_STATUS_URL || `${FLOW_BASE_URL}/fx/api/video/status`
).replace(/\/+$/, "");

function safeSnippet(v, max = 1200) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ✅ “cách 1” bạn chọn: dán CHỈ token ya29... vào app
// -> backend nhận token từ Authorization OR body.session OR body.access_token OR header x-flow-session/x-flow-token
function pickBearer(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) return auth.trim();

  const h1 = req.headers["x-flow-session"];
  const h2 = req.headers["x-flow-token"];
  const ht = (typeof h1 === "string" && h1.trim()) ? h1.trim() : (typeof h2 === "string" && h2.trim() ? h2.trim() : "");

  const bodyToken =
    (typeof req.body?.session === "string" && req.body.session.trim()) ? req.body.session.trim() :
    (typeof req.body?.access_token === "string" && req.body.access_token.trim()) ? req.body.access_token.trim() :
    (typeof req.body?.token === "string" && req.body.token.trim()) ? req.body.token.trim() :
    "";

  const token = ht || bodyToken;
  if (!token) return "";

  // allow user to paste "Bearer ya29..." or just "ya29..."
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
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

// ---------- SESSION VALIDATE (support BOTH GET + POST to avoid mismatch) ----------
async function validateHandler(req, res) {
  const bearer = pickBearer(req);

  log("FLOW_VALIDATE", {
    method: req.method,
    path: req.path,
    hasAuth: !!bearer,
    upstream: FLOW_SESSION_VALIDATE_URL,
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing token. Provide Authorization: Bearer <ya29...> (or body.session).",
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
}

router.get("/session/validate", validateHandler);
router.post("/session/validate", validateHandler);

// ---------- VIDEO GENERATE ----------
router.post("/video/generate", async (req, res) => {
  const bearer = pickBearer(req);
  const payload = req.body || {};

  log("FLOW_GENERATE", {
    path: req.path,
    hasAuth: !!bearer,
    upstream: FLOW_VEO_GENERATE_URL,
    keys: Object.keys(payload || {}),
    promptPreview: safeSnippet(payload?.prompt || payload?.text || "", 120),
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing token. Provide Authorization: Bearer <ya29...> (or body.session).",
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
});

// ---------- VIDEO STATUS ----------
router.get("/video/status/:id", async (req, res) => {
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
      error: "Missing token. Provide Authorization: Bearer <ya29...> (or body.session).",
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
});

// debug (optional)
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
