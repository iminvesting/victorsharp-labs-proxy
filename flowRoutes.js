import express from "express";

const router = express.Router();

/**
 * Helper: lấy Bearer token
 */
function getBearer(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
}

/**
 * Helper: gọi upstream + đọc JSON/Text an toàn
 */
async function safeReadBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

/* =========================
   1) VALIDATE SESSION TOKEN
   (simple: chỉ check format ya29.)
========================= */
router.post("/session/validate", (req, res) => {
  const token = getBearer(req);
  if (!token || !token.startsWith("ya29.")) {
    return res.status(401).json({ ok: false, error: "Invalid Flow token" });
  }
  return res.json({ ok: true });
});

/* =========================
   2) CREATE VIDEO JOB
   -> dùng Google Generative Language API
   -> predictLongRunning -> trả operation name
========================= */
router.post("/video/generate", async (req, res) => {
  try {
    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    const { prompt, imageBase64, aspectRatio = "9:16" } = req.body || {};
    if (!prompt || !imageBase64) {
      return res.status(400).json({
        ok: false,
        error: "Missing prompt or imageBase64"
      });
    }

    // ✅ Endpoint đúng kiểu LRO (long running operation)
    const upstream =
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast:predictLongRunning";

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        instances: [
          {
            prompt,
            image: { bytesBase64Encoded: imageBase64 },
            aspectRatio
          }
        ]
      })
    });

    const body = await safeReadBody(upstreamRes);

    if (!upstreamRes.ok) {
      return res.status(502).json({
        ok: false,
        error: "Create job failed",
        upstream,
        upstreamStatus: upstreamRes.status,
        upstreamBody: body
      });
    }

    // thường sẽ có name: "operations/xxxx"
    const operation = body?.name;
    if (!operation) {
      return res.status(500).json({
        ok: false,
        error: "Upstream ok but missing operation name",
        upstreamBody: body
      });
    }

    return res.json({ ok: true, operation });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =========================
   3) POLL STATUS
   -> GET /v1beta/{operation}
   -> done? lấy video URL
========================= */
router.post("/video/status", async (req, res) => {
  try {
    const token = getBearer(req);
    const { operation } = req.body || {};

    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
    if (!operation) return res.status(400).json({ ok: false, error: "Missing operation" });

    const upstream = `https://generativelanguage.googleapis.com/v1beta/${operation}`;

    const upstreamRes = await fetch(upstream, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    const body = await safeReadBody(upstreamRes);

    if (!upstreamRes.ok) {
      return res.status(502).json({
        ok: false,
        error: "Poll failed",
        upstream,
        upstreamStatus: upstreamRes.status,
        upstreamBody: body
      });
    }

    if (!body?.done) {
      return res.json({ ok: true, status: "processing" });
    }

    // cố gắng lấy video uri từ các shape khác nhau
    const videoUrl =
      body?.response?.outputs?.[0]?.video?.uri ||
      body?.response?.videos?.[0]?.uri ||
      body?.response?.video?.uri;

    if (!videoUrl) {
      return res.status(500).json({
        ok: false,
        error: "Done but videoUrl not found",
        raw: body
      });
    }

    return res.json({ ok: true, status: "done", videoUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
