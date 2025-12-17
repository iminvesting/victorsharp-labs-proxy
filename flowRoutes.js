import express from "express";

const router = express.Router();

const FLOW_SESSION_VALIDATE_URL =
  process.env.FLOW_SESSION_VALIDATE_URL || "https://labs.google/fx/api/auth/session";
const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/video/generate";
const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/video/status";

function pickBearer(req) {
  const auth = req.headers.authorization || "";
  const s = String(auth).trim();
  if (!s) return "";

  // normalize: allow "Bearer xxx" or "bearer xxx" or raw token
  if (/^bearer\s+/i.test(s)) return `Bearer ${s.replace(/^bearer\s+/i, "").trim()}`;
  return `Bearer ${s}`;
}

async function upstreamJson(url, method, bearer, body) {
  const headers = {
    Authorization: bearer,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text; // html/text
  }

  return { res, parsed, rawText: text };
}

// 1) Validate session
router.post("/session/validate", async (req, res) => {
  const bearer = pickBearer(req);
  if (!bearer) return res.status(400).json({ ok: false, error: "Missing Authorization Bearer token" });

  try {
    console.log("[FLOW_VALIDATE] ->", FLOW_SESSION_VALIDATE_URL);

    const { res: up, parsed, rawText } = await upstreamJson(FLOW_SESSION_VALIDATE_URL, "GET", bearer);

    if (!up.ok) {
      return res.status(500).json({
        ok: false,
        error: "Validate Session Failed",
        upstream: FLOW_SESSION_VALIDATE_URL,
        upstreamStatus: up.status,
        upstreamBody: rawText,
      });
    }

    return res.status(200).json({ ok: true, data: parsed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// 2) Generate video job
router.post("/video/generate", async (req, res) => {
  const bearer = pickBearer(req);
  if (!bearer) return res.status(400).json({ ok: false, error: "Missing Authorization Bearer token" });

  try {
    console.log("[FLOW_GENERATE] ->", FLOW_VEO_GENERATE_URL);

    const { res: up, parsed, rawText } = await upstreamJson(FLOW_VEO_GENERATE_URL, "POST", bearer, req.body || {});

    if (!up.ok) {
      return res.status(500).json({
        ok: false,
        error: "Create Job Failed",
        upstream: FLOW_VEO_GENERATE_URL,
        upstreamStatus: up.status,
        upstreamBody: rawText,
      });
    }

    // Normalize jobId
    const jobId = parsed?.jobId || parsed?.id || parsed?.name || parsed?.job_id;
    return res.status(200).json({ ok: true, jobId, data: parsed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// 3) Status
router.get("/video/status/:jobId", async (req, res) => {
  const bearer = pickBearer(req);
  if (!bearer) return res.status(400).json({ ok: false, error: "Missing Authorization Bearer token" });

  const jobId = req.params.jobId;
  try {
    const url = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(jobId)}`;
    console.log("[FLOW_STATUS] ->", url);

    const { res: up, parsed, rawText } = await upstreamJson(url, "GET", bearer);

    if (!up.ok) {
      return res.status(500).json({
        ok: false,
        error: "Status Check Failed",
        upstream: url,
        upstreamStatus: up.status,
        upstreamBody: rawText,
      });
    }

    return res.status(200).json({ ok: true, data: parsed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/**
 * Backward-compatible aliases:
 * /api/flow/veo/generate -> /api/flow/video/generate
 * /api/flow/veo/status/:jobId -> /api/flow/video/status/:jobId
 */
router.post("/veo/generate", (req, res, next) => {
  req.url = "/video/generate";
  next();
});
router.get("/veo/status/:jobId", (req, res, next) => {
  req.url = `/video/status/${req.params.jobId}`;
  next();
});

export default router;
