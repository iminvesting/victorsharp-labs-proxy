// server.js  – VictorSharp Labs Proxy v3
import express from "express";
import fetch from "node-fetch";

const app = express();

// Đọc body JSON từ desktop
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;

// Endpoint chính của Veo 3.1 fast trên Labs
const LABS_ENDPOINT =
  "https://labs.google/aisandbox/v1/projects/764086051850/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning";

// Helper: lấy token từ header
function extractLabsToken(req) {
  // Desktop v3 gửi ở đây
  const xHeader = req.headers["x-labs-token"];
  if (xHeader && typeof xHeader === "string") return xHeader.trim();

  // Phòng trường hợp app khác gửi kiểu Authorization: Bearer ya29...
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string") {
    if (auth.toLowerCase().startsWith("bearer ")) {
      return auth.slice(7).trim();
    }
  }

  return null;
}

// Test route
app.get("/", (_req, res) => {
  res.send("VictorSharp Labs Proxy v3 is running.");
});

// Route desktop sẽ gọi
app.post("/labs/generate", async (req, res) => {
  try {
    const labsToken = extractLabsToken(req);

    if (!labsToken) {
      return res.status(400).json({
        error:
          'Missing Labs token. Send header "x-labs-token: ya29..." or "Authorization: Bearer ya29..."',
      });
    }

    console.log(">> [Proxy] Forwarding to Google Labs /veo-3.1-fast-generate-001");
    console.log("   Body keys:", Object.keys(req.body || {}));

    const response = await fetch(LABS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${labsToken}`,
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    console.log("<< [Proxy] Google status:", response.status);

    res.status(response.status).json(data);
  } catch (err) {
    console.error("!! [Proxy] Unexpected error:", err);
    res.status(500).json({
      error: "Proxy internal error",
      details: err?.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`VictorSharp Labs Proxy v3 listening on port ${PORT}`);
});
