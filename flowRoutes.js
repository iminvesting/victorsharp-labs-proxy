// flowRoutes.js
// Express router for Flow (Google Labs FX) session validate + Veo generate + status
// Supports BOTH path styles:
//   /api/flow/veo/generate  and /api/flow/video/generate
//   /api/flow/veo/status/:id and /api/flow/video/status/:id

const express = require("express");
const router = express.Router();

const FLOW_BASE_URL = process.env.FLOW_BASE_URL || "https://labs.google";
const FLOW_SESSION_VALIDATE_URL =
  process.env.FLOW_SESSION_VALIDATE_URL ||
  `${FLOW_BASE_URL}/fx/api/auth/session`;

const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL ||
  `${FLOW_BASE_URL}/fx/api/video/generate`;

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL ||
  `${FLOW_BASE_URL}/fx/api/video/status`;

function nowIso() {
  return new Date().toISOString();
}

function pickBearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  // Expect: "Bearer ya29...."
  return auth;
}

function log(tag, obj) {
  try {
    console.log(
      JSON.stringify(
        { tag, ts: nowIso(), ...obj },
        null,
        0
      )
    );
  } catch (e) {
    console.log(`[${tag}]`, obj);
  }
}

async function readUpstreamBody(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // Try JSON first if content-type says json
  if (ct.includes("application/json")) {
    try {
      return { kind: "json", data: await res.json() };
    } catch (e) {
      // fallthrough to text
    }
  }

  // Otherwise read text (also handles HTML error pages)
  const text = await res.text();
  return { kind: "text", data: text };
}

function safeSnippet(v, max = 280) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ----------- Validate Session -----------
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
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      log("FLOW_VALIDATE_FAIL", {
        status: upstreamRes.status,
        contentType: upstreamRes.headers.get("content-type"),
        snippet: safeSnippet(body.data),
      });

      return res.status(upstreamRes.status).json({
        ok: false,
        upstreamStatus: upstreamRes.status,
        upstream: FLOW_SESSION_VALIDATE_URL,
        body: body.kind === "json" ? body.data : safeSnippet(body.data, 2000),
      });
    }

    // Usually returns JSON like {access_token:"...", expires:"..."} or similar
    return res.status(200).json({
      ok: true,
      upstream: FLOW_SESSION_VALIDATE_URL,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    log("FLOW_VALIDATE_ERROR", { message: String(err?.message || err) });
    return res.status(500).json({
      ok: false,
      error: "Validate session failed",
      detail: String(err?.message || err),
    });
  }
});

// ----------- Generate (handler used by both /veo/generate and /video/generate) -----------
async function handleGenerate(req, res) {
  const bearer = pickBearer(req);

  // Body from WebApp: usually {prompt, ...} (and sometimes image refs)
  const payload = req.body || {};
  const promptPreview = safeSnippet(payload?.prompt || "", 120);

  log("FLOW_VEO_GENERATE", {
    path: req.path,
    hasAuth: !!bearer,
    bodyBytes: Buffer.byteLength(JSON.stringify(payload || {}), "utf8"),
    upstream: FLOW_VEO_GENERATE_URL,
    promptPreview,
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  try {
    const upstreamRes = await fetch(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      log("FLOW_VEO_GENERATE_FAIL", {
        upstreamStatus: upstreamRes.status,
        upstreamContentType: upstreamRes.headers.get("content-type"),
        snippet: safeSnippet(body.data, 800),
      });

      // IMPORTANT: return JSON so frontend doesn't choke on HTML
      return res.status(upstreamRes.status).json({
        ok: false,
        error: `Create Job Failed (${upstreamRes.status})`,
        upstream: FLOW_VEO_GENERATE_URL,
        upstreamStatus: upstreamRes.status,
        upstreamBody:
          body.kind === "json" ? body.data : safeSnippet(body.data, 4000),
      });
    }

    // Success response often includes operation / job id
    return res.status(200).json({
      ok: true,
      upstream: FLOW_VEO_GENERATE_URL,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    log("FLOW_VEO_GENERATE_ERROR", { message: String(err?.message || err) });
    return res.status(502).json({
      ok: false,
      error: "Flow generate failed (proxy fetch error)",
      upstream: FLOW_VEO_GENERATE_URL,
      detail: String(err?.message || err),
    });
  }
}

// Support BOTH route names
router.post("/veo/generate", handleGenerate);
router.post("/video/generate", handleGenerate);

// ----------- Status (handler used by both /veo/status/:id and /video/status/:id) -----------
async function handleStatus(req, res) {
  const bearer = pickBearer(req);
  const opId = req.params.id;

  const upstreamUrl = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(opId)}`;

  log("FLOW_VEO_STATUS", {
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
      },
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      log("FLOW_VEO_STATUS_FAIL", {
        upstreamStatus: upstreamRes.status,
        snippet: safeSnippet(body.data, 800),
      });

      return res.status(upstreamRes.status).json({
        ok: false,
        error: `Status Failed (${upstreamRes.status})`,
        upstream: upstreamUrl,
        upstreamStatus: upstreamRes.status,
        upstreamBody:
          body.kind === "json" ? body.data : safeSnippet(body.data, 4000),
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: upstreamUrl,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    log("FLOW_VEO_STATUS_ERROR", { message: String(err?.message || err) });
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

// Optional: quick debug endpoint
router.get("/debug/env", (req, res) => {
  res.json({
    ok: true,
    FLOW_BASE_URL,
    FLOW_SESSION_VALIDATE_URL,
    FLOW_VEO_GENERATE_URL,
    FLOW_VEO_STATUS_URL,
  });
});

module.exports = router;
