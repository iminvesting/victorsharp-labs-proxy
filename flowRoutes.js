// flowRoutes.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/**
 * Validate Flow Session
 */
router.post("/session/validate", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(400).json({ ok: false, error: "Missing session token" });
  }

  // CHỈ check hình thức – Flow không có API validate chính thức
  if (!token.startsWith("ya29.")) {
    return res.status(401).json({ ok: false, error: "Invalid token format" });
  }

  return res.json({ ok: true });
});

/**
 * CREATE VIDEO – FLOW VEO3
 */
router.post("/video/generate", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing Flow token" });
    }

    const {
      prompt,
      imageBase64,
      aspectRatio = "9:16"
    } = req.body;

    if (!prompt || !imageBase64) {
      return res.status(400).json({
        ok: false,
        error: "Missing prompt or imageBase64"
      });
    }

    // 🔥 ENDPOINT ĐÚNG
    const upstream = "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast:predictLongRunning";

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        instances: [{
          prompt,
          image: { bytesBase64Encoded: imageBase64 },
          aspectRatio
        }]
      })
    });

    const text = await upstreamRes.text();

    if (!upstreamRes.ok) {
      return res.status(502).json({
        ok: false,
        error: "Create Job Failed",
        upstreamStatus: upstreamRes.status,
        upstreamBody: text
      });
    }

    return res.json({
      ok: true,
      job: JSON.parse(text)
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err)
    });
  }
});

export default router;
