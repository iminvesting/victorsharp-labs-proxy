// server.js – VictorSharp Flow Veo3 Backend Proxy (Render)
// Dùng cho Web App (AI Studio Preview / Web)
// KHÔNG dùng x-labs-token
// Dùng Authorization: Bearer <access_token>

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

/* =======================
   Middleware
======================= */
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* =======================
   Health Check
======================= */
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "VictorSharp Flow Veo3 Proxy" });
});

/* =======================
   Helper: Bearer Token
======================= */
function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.replace("Bearer ", "");
}

/* =======================
   Validate Session
======================= */
app.post("/api/flow/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization Bearer token" });
  }
  // Token hợp lệ hay không sẽ do Flow kiểm tra ở bước generate
  return res.json({ ok: true });
});

/* =======================
   Generate Video (Veo3)
======================= */
app.post("/api/flow/veo/generate", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization Bearer token" });
  }

  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ error: "Missing request body" });
  }

  try {
    const resp = await fetch(
      "https://labs.google/fx/api/veo/generate",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await resp.json();
    return res.status(resp.status).json(data);
  } catch (err) {
    console.error("[FLOW GENERATE ERROR]", err);
    return res.status(500).json({ error: "Flow generate failed" });
  }
});

/* =======================
   Poll Status
======================= */
app.get("/api/flow/veo/status/:jobId", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization Bearer token" });
  }

  try {
    const resp = await fetch(
      `https://labs.google/fx/api/veo/status/${req.params.jobId}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await resp.json();
    return res.status(resp.status).json(data);
  } catch (err) {
    console.error("[FLOW STATUS ERROR]", err);
    return res.status(500).json({ error: "Flow status failed" });
  }
});

/* =======================
   Start Server
======================= */
app.listen(PORT, () => {
  console.log("VictorSharp Flow Veo3 Proxy running on port", PORT);
});
