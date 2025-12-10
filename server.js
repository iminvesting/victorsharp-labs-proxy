// server.js – VictorSharp Labs Proxy v3 (no node-fetch)

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json());

// Root check
app.get("/", (_req, res) => {
  res.send("VictorSharp Labs Proxy is running.");
});

// Helper: lấy token từ header (Authorization hoặc x-labs-token)
function extractLabsToken(req) {
  const authHeader = req.headers["authorization"];
  const labsHeader = req.headers["x-labs-token"];

  // Ưu tiên Authorization: Bearer ya29...
  if (authHeader && typeof authHeader === "string") {
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.substring("Bearer ".length).trim();
    }
    return authHeader.trim();
  }

  // Nếu Desktop gửi x-labs-token thì dùng luôn
  if (labsHeader && typeof labsHeader === "string") {
    return labsHeader.trim();
  }

  return null;
}

// ====== MAIN ROUTE ======
app.post("/labs/generate", async (req, res) => {
  console.log("[PROXY] Incoming /labs/generate");

  const token = extractLabsToken(req);

  if (!token) {
    console.warn("[PROXY] Missing Labs token in headers");
    return res.status(400).json({
      error: "Missing Authorization header (Bearer ya29... token)",
    });
  }

  const targetUrl =
    "https://labs.google/aisandbox/v1/projects/764086051850/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning";

  try {
    console.log("[PROXY] Forwarding to Labs:", targetUrl);

    // Dùng global fetch của Node (>=18), không cần node-fetch
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    const status = upstream.status;
    const contentType =
      upstream.headers.get("content-type") || "application/json";

    console.log("[PROXY] Labs response status:", status);

    res.status(status);
    res.set("Content-Type", contentType);
    res.send(text);
  } catch (err) {
    console.error("[PROXY] Error calling Labs:", err);
    res.status(500).json({
      error: "proxy_error",
      message: err.message || String(err),
    });
  }
});

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`VictorSharp Labs Proxy listening on port ${PORT}`);
});
