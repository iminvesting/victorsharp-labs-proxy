// flowRoutes.js (ESM) - VictorSharp Flow Veo Proxy Routes
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/** =========================
 *  Helpers
 *  ========================= */
function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

async function readUpstreamBody(resp) {
  // labs.google đôi khi trả HTML hoặc JSON rỗng "{}"
  const text = await resp.text().catch(() => "");
  if (!text) return { text: "", json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

function upstreamError(res, message, upstreamUrl, upstreamStatus, upstreamBody) {
  return res.status(200).json({
    ok: false,
    error: message,
    upstream: upstreamUrl,
    upstreamStatus,
    upstreamBody: upstreamBody ?? "",
  });
}

/** =========================
 *  Upstream endpoints (Render ENV)
 *  =========================
 * Bạn đang set ở Render:
 * FLOW_VEO_GENERATE_URL = https://labs.google/fx/api/video/generate
 * FLOW_VEO_STATUS_URL   = https://labs.google/fx/api/video/status
 *
 * Nếu thiếu ENV thì fallback về giá trị này.
 */
const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/video/generate";

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/video/status";

const FLOW_SESSION_VALIDATE_URL =
  process.env.FLOW_SESSION_VALIDATE_URL || "https://labs.google/fx/api/auth/session";

/** =========================
 *  Session Validate
 *  POST /api/flow/session/validate
 *  Header: Authorization: Bearer <access_token>
 *  ========================= */
router.post("/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });
  }

  try {
    const upstreamUrl = FLOW_SESSION_VALIDATE_URL;

    const resp = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept": "application/json,text/plain,*/*",
      },
    });

    const { text, json } = await readUpstreamBody(resp);

    // OK => cho pass
    if (resp.ok) {
      return res.json({ ok: true, upstream: upstreamUrl });
    }

    // Fail => trả kèm upstreamStatus/upstreamBody để debug trên WebApp
    return upstreamError(res, "Session validate failed", upstreamUrl, resp.status, text || "{}");
  } catch (err) {
    return upstreamError(res, `Session validate exception: ${err?.message || err}`, FLOW_SESSION_VALIDATE_URL, 0, "");
  }
});

/** =========================
 *  Create Job (Generate Video)
 *  POST /api/flow/veo/generate
 *  POST /api/flow/video/generate   (alias)
 *  Body: JSON payload from WebApp
 *  ========================= */
async function handleGenerate(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });
  }

  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "Missing/invalid JSON body" });
  }

  const upstreamUrl = FLOW_VEO_GENERATE_URL;

  try {
    const resp = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json,text/plain,*/*",
      },
      body: JSON.stringify(payload),
    });

    const { text, json } = await readUpstreamBody(resp);

    // Nếu upstream trả JSON hợp lệ => forward nguyên JSON
    if (json) {
      return res.status(resp.status).json(json);
    }

    // Nếu upstream trả HTML/text => vẫn trả để WebApp thấy upstreamBody
    return res.status(resp.status).json({
      ok: resp.ok,
      upstream: upstreamUrl,
      upstreamStatus: resp.status,
      upstreamBody: text,
    });
  } catch (err) {
    return upstreamError(res, `Flow generate exception: ${err?.message || err}`, upstreamUrl, 0, "");
  }
}

router.post("/veo/generate", handleGenerate);
router.post("/video/generate", handleGenerate); // alias cho WebApp nếu đổi path

/** =========================
 *  Poll Status
 *  GET /api/flow/veo/status/:jobId
 *  GET /api/flow/video/status/:jobId   (alias)
 *  ========================= */
async function handleStatus(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });
  }

  const jobId = req.params.jobId;
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "Missing jobId" });
  }

  const upstreamUrl = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(jobId)}`;

  try {
    const resp = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept": "application/json,text/plain,*/*",
      },
    });

    const { text, json } = await readUpstreamBody(resp);

    if (json) {
      return res.status(resp.status).json(json);
    }

    return res.status(resp.status).json({
      ok: resp.ok,
      upstream: upstreamUrl,
      upstreamStatus: resp.status,
      upstreamBody: text,
    });
  } catch (err) {
    return upstreamError(res, `Flow status exception: ${err?.message || err}`, upstreamUrl, 0, "");
  }
}

router.get("/veo/status/:jobId", handleStatus);
router.get("/video/status/:jobId", handleStatus); // alias

export default router;
export { router };
