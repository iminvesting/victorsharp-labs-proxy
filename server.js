import express from "express";
import cors from "cors";

// VictorSharp Labs Proxy for Google VideoFX (Veo 3.x)
// ---------------------------------------------------
// This proxy is meant to be deployed on Render.com (US region).
// It forwards requests from the Desktop app to the internal Labs endpoint
// using the Labs session token (ya29...) in the Authorization header.

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

// Internal Labs endpoint path (from Flow VideoFX network logs).
// If Google changes it in the future, update this string.
const LABS_TARGET_PATH =
  "/aisandbox/v1/projects/764086051850/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning";

const LABS_BASE_URL = process.env.LABS_BASE_URL || "https://labs.google";
const LABS_ENDPOINT = process.env.LABS_ENDPOINT || (LABS_BASE_URL + LABS_TARGET_PATH);

app.post("/labs/generate", async (req, res) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || typeof authHeader !== "string") {
    return res
      .status(400)
      .json({ error: "Missing Authorization header (Bearer ya29... token)" });
  }

  try {
    const labsRes = await fetch(LABS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "Origin": "https://labs.google",
        "Referer": "https://labs.google/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
      },
      body: JSON.stringify(req.body)
    });

    const text = await labsRes.text();
    res.status(labsRes.status).send(text);
  } catch (err) {
    console.error("Labs proxy error:", err);
    const message =
      err && typeof err === "object" && "message" in err ? err.message : String(err);
    res.status(500).json({
      error: "Proxy error calling Google Labs",
      detail: message
    });
  }
});

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`VictorSharp Labs Proxy listening on port ${PORT}`);
  console.log(`Forwarding to: ${LABS_ENDPOINT}`);
});
