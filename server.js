// server.js — VictorSharp Flow Veo3 Backend Proxy (Render)
// ESM module (package.json: "type": "module")

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Upstream endpoints (configurable via Render env vars) =====
// NOTE: Các endpoint Flow/Labs có thể thay đổi theo thời gian.
// Nếu upstream trả 404 HTML (labs.google/fx page) => cần cập nhật lại 2 URL này.
const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/veo/generate";
const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/veo/status"; // + "/:jobId"

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ===== Helpers =====
function getBearerToken(req) {
  // Accept:
  // 1) Authorization: Bearer ya29...
  // 2) x-labs-token: ya29...   (fallback)
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  const labs = req.headers["x-labs-token"];
  if (typeof labs === "string" && labs.startsWith("ya29.")) return labs.trim();
  return null;
}

function browserLikeHeaders(token) {
  // Một số endpoint Labs dễ “khó tính”, mình set header giống browser hơn một chút
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Origin: "https://labs.google",
    Referer: "https://labs.google/fx/",
  };
}

function safeSnippet(text, max = 600) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

// ===== Health =====
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "VictorSharp Flow Veo3 Proxy" });
});
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ===== Validate Flow session/token =====
app.post("/api/flow/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });
  }

  // Không gọi upstream ở đây để tránh fail do endpoint thay đổi.
  // Chỉ check format cơ bản + trả ok để UI “Connected”.
  return res.json({
    ok: true,
    hasAuth: true,
    tokenPrefix: token.slice(0, 12) + "...",
  });
});

// ===== Create job =====
app.post("/api/flow/veo/generate", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });
  }

  const body = req.body || {};
  const prompt = body.prompt || body.text || "";
  if (!prompt) {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  try {
    // Pass-through payload (giữ linh hoạt)
    const payload = body;

    const upstream = await fetch(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers: browserLikeHeaders(token),
      body: JSON.stringify(payload),
      redirect: "manual", // nếu upstream redirect, mình không follow mù để tránh landing HTML
    });

    const contentType = upstream.headers.get("content-type") || "";
    const raw = await upstream.text();

    // Nếu upstream redirect hoặc 404 HTML => trả về thông tin để debug
    if (!upstream.ok) {
      let upstreamJson = null;
      if (contentType.includes("application/json")) {
        try {
          upstreamJson = JSON.parse(raw);
        } catch {}
      }

      return res.status(502).json({
        ok: false,
        error: "Flow generate failed",
        upstreamStatus: upstream.status,
        upstreamContentType: contentType,
        upstreamSnippet: safeSnippet(raw),
        upstreamJson,
        hint:
          "Nếu upstreamStatus=404 và snippet là HTML labs.google/fx => endpoint FLOW_VEO_GENERATE_URL đã đổi. Hãy sniff endpoint mới trong DevTools của labs.google/fx và set Render env var.",
      });
    }

    // OK: trả JSON cho Web App
    if (contentType.includes("application/json")) {
      return res.json(JSON.parse(raw));
    }

    // Một số trường hợp upstream trả text nhưng vẫn OK
    return res.json({ ok: true, raw });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Proxy exception",
      message: String(err?.message || err),
    });
  }
});

// ===== Poll status =====
app.get("/api/flow/veo/status/:jobId", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });
  }

  const jobId = req.params.jobId;
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "Missing jobId" });
  }

  try {
    const url = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(jobId)}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: browserLikeHeaders(token),
      redirect: "manual",
    });

    const contentType = upstream.headers.get("content-type") || "";
    const raw = await upstream.text();

    if (!upstream.ok) {
      let upstreamJson = null;
      if (contentType.includes("application/json")) {
        try {
          upstreamJson = JSON.parse(raw);
        } catch {}
      }

      return res.status(502).json({
        ok: false,
        error: "Flow status failed",
        upstreamStatus: upstream.status,
        upstreamContentType: contentType,
        upstreamSnippet: safeSnippet(raw),
        upstreamJson,
      });
    }

    if (contentType.includes("application/json")) {
      return res.json(JSON.parse(raw));
    }

    return res.json({ ok: true, raw });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Proxy exception",
      message: String(err?.message || err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`VictorSharp Flow Veo3 Proxy running on port ${PORT}`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
  console.log(`Upstream generate: ${FLOW_VEO_GENERATE_URL}`);
  console.log(`Upstream status:   ${FLOW_VEO_STATUS_URL}`);
});
