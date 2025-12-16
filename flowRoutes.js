import express from "express";

const router = express.Router();

/* ================= ENV ================= */

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

/* ================= Utils ================= */

const nowIso = () => new Date().toISOString();

const pickBearer = (req) =>
  req.headers.authorization || req.headers.Authorization || "";

const safeSnippet = (v, max = 300) => {
  if (!v) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "..." : s;
};

async function readUpstream(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("json")) {
    try {
      return await res.json();
    } catch {
      return await res.text();
    }
  }
  return await res.text();
}

/* ================= Session Validate ================= */

router.post("/session/validate", async (req, res) => {
  const bearer = pickBearer(req);
  if (!bearer)
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  try {
    const upstream = await fetch(FLOW_SESSION_VALIDATE_URL, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const body = await readUpstream(upstream);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: "Session validate failed",
        upstreamStatus: upstream.status,
        upstreamBody: safeSnippet(body, 2000),
      });
    }

    return res.json({ ok: true, data: body });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Validate exception",
      detail: String(e),
    });
  }
});

/* ================= Generate ================= */

async function handleGenerate(req, res) {
  const bearer = pickBearer(req);
  if (!bearer)
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  try {
    const upstream = await fetch(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body || {}),
    });

    const body = await readUpstream(upstream);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: `Create Job Failed (${upstream.status})`,
        upstream: FLOW_VEO_GENERATE_URL,
        upstreamBody: safeSnippet(body, 4000),
      });
    }

    return res.json({ ok: true, data: body });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "Generate exception",
      detail: String(e),
    });
  }
}

router.post("/veo/generate", handleGenerate);
router.post("/video/generate", handleGenerate);

/* ================= Status ================= */

async function handleStatus(req, res) {
  const bearer = pickBearer(req);
  if (!bearer)
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  const opId = req.params.id;
  const url = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(opId)}`;

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: bearer },
    });

    const body = await readUpstream(upstream);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: `Status Failed (${upstream.status})`,
        upstreamBody: safeSnippet(body, 4000),
      });
    }

    return res.json({ ok: true, data: body });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "Status exception",
      detail: String(e),
    });
  }
}

router.get("/veo/status/:id", handleStatus);
router.get("/video/status/:id", handleStatus);

/* ================= Export ================= */

export default router;
