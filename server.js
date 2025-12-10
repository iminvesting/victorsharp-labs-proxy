// server.js – VictorSharp Labs Proxy v3 (CommonJS)

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// URL Veo fast-generate (Labs sandbox)
const TARGET_URL =
  "https://labs.google/aisandbox/v1/projects/764086051850/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning";

// Helper: lấy token từ header (Authorization hoặc x-labs-token)
function extractLabsToken(req) {
  // Desktop gửi trong header x-labs-token
  let token = req.headers["x-labs-token"];

  // fallback: nếu sau này mình gửi dạng Authorization: Bearer ya29...
  if (!token && req.headers["authorization"]) {
    const auth = req.headers["authorization"];
    if (auth.toLowerCase().startsWith("bearer ")) {
      token = auth.slice(7).trim();
    }
  }

  return token;
}

// Root check
app.get("/", (_req, res) => {
  res.send("VictorSharp Labs Proxy is running.");
});

// Endpoint Desktop sẽ gọi
app.post("/labs/generate", async (req, res) => {
  try {
    const labsToken = extractLabsToken(req);

    if (!labsToken) {
      return res.status(400).json({
        error: "Missing Authorization header (Bearer ya29... token)",
      });
    }

    // Gửi request sang Google Labs
    const upstreamResponse = await fetch(TARGET_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${labsToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstreamResponse.text();
    let json;

    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { raw: text };
    }

    res.status(upstreamResponse.status).json(json);
  } catch (err) {
    console.error("[PROXY] Error:", err);
    res.status(500).json({ error: "Proxy error", details: String(err) });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`VictorSharp Labs Proxy listening on port ${PORT}`);
  console.log(`Forwarding to: ${TARGET_URL}`);
});
