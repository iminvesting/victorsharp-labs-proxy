// server.js - VictorSharp Labs Proxy v3 (Labs → Veo 3.1)

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Root check
app.get("/", (_req, res) => {
  res.send("VictorSharp Labs Proxy is running.");
});

// Helper: lấy Labs token từ header (Authorization: Bearer ya29... hoặc x-labs-token)
function extractLabsToken(req) {
  // Desktop gửi lên qua header x-labs-token
  const header = req.headers["x-labs-token"];
  if (!header || typeof header !== "string") return null;

  // thường là chuỗi "ya29...."
  if (header.startsWith("ya29.")) return header;

  // nếu sau này gửi kiểu "Bearer ya29..." thì vẫn tách được
  const parts = header.split(" ");
  return parts[parts.length - 1];
}

// URL VEO 3.1 trên Google Labs (HOST ĐẦY ĐỦ)
const LABS_VEO_ENDPOINT =
  "https://labs.google/aisandbox/v1/projects/764086051850/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning";

// ===== MAIN PROXY ROUTE =====
app.post("/labs/generate", async (req, res) => {
  const labsToken = extractLabsToken(req);

  if (!labsToken) {
    return res
      .status(400)
      .json({ error: "Missing x-labs-token header (Bearer ya29... token)" });
  }

  try {
    // Forward body + token sang Google Labs
    const upstream = await fetch(LABS_VEO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${labsToken}`,
      },
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    res.status(upstream.status);

    // cố gắng parse JSON, nếu fail thì trả raw text
    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch {
      return res.send(text);
    }
  } catch (err) {
    console.error("[Proxy] Error calling Labs:", err);
    res.status(500).json({
      error: "Proxy error calling Labs",
      detail: String(err),
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`VictorSharp Labs Proxy listening on port ${PORT}`);
  console.log(`Forwarding to: ${LABS_VEO_ENDPOINT}`);
});

export default app;
