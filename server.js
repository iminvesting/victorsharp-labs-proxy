// server.js – VictorSharp Labs Proxy v3 (Labs → Render VEO)
// Simple Express proxy that accepts POST /labs/generate from desktop
// and forwards to Google Labs VEO endpoint with the Labs session token.

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Root check
app.get("/", (_req, res) => {
  res.send("VictorSharp Labs Proxy is running.");
});

// Helper: lấy token từ header (Authorization: Bearer ya29...)
// Desktop sẽ gửi token trong header x-labs-token, ta chuyển thành Authorization.
function extractLabsToken(req) {
  const labsHeader = req.headers["x-labs-token"];
  if (!labsHeader || typeof labsHeader !== "string") return null;
  if (!labsHeader.startsWith("ya29.")) return null;
  return labsHeader;
}

// Main endpoint: Desktop → Proxy
// body: { prompt: string }
app.post("/labs/generate", async (req, res) => {
  try {
    const token = extractLabsToken(req);
    if (!token) {
      return res.status(400).json({
        error: "Missing x-labs-token header (ya29... token)",
      });
    }

    const prompt = req.body?.prompt || "";
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt in body" });
    }

    // Google Labs VEO endpoint (long-running)
    const labsUrl =
      "https://labs.google/aisandbox/v1/projects/764086051850/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning";

    const payload = {
      // Very small demo payload – desktop có thể mở rộng thêm nếu cần
      input: {
        text: prompt,
      },
      config: {
        // just placeholders; real config can be passed from desktop later
        duration_seconds: 4,
        aspect_ratio: "16:9",
      },
    };

    console.log("[PROXY] Forwarding to Labs VEO…");

    const labsResp = await fetch(labsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await labsResp.text();
    let json;
    try {
      json = JSON.parse(rawText);
    } catch (e) {
      json = { raw: rawText };
    }

    if (!labsResp.ok) {
      console.error("[PROXY] Labs error", labsResp.status, json);
      return res.status(labsResp.status).json(json);
    }

    return res.json(json);
  } catch (err) {
    console.error("[PROXY] Unexpected error:", err);
    return res.status(500).json({ error: "Proxy internal error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log("VictorSharp Labs Proxy listening on port", PORT);
  console.log("Your service is live ✨");
  console.log("////////////////////////////////////////////////////////");
});
