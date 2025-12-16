// server.js — VictorSharp Flow Veo3 Backend Proxy (Render)
// ESModule (package.json: "type": "module")

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

// Render will inject PORT. Keep default for local dev.
const PORT = process.env.PORT || 10000;

// ===== Config (can be overridden in Render Environment Variables) =====
// IMPORTANT: These upstream endpoints may change. Make them configurable.
const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/veo/generate";
const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/veo/status"; // + /:jobId

// Optional headers to mimic browser context if needed
const FLOW_ORIGIN = process.env.FLOW_ORIGIN || "https://labs.google";
const FLOW_REFERER = process.env.FLOW_REFERER || "https://labs.google/fx/";

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ===== Helpers =====
function nowIso() {
  return new Date().toISOString();
}

function logEvent(tag, extra = {}) {
  // Single-line JSON log (easy to read on Render)
  console.log(JSON.stringify({ tag, ts: nowIso(), ...extra }));
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  // Expect: "Bearer ya29...."
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function fetchUpstream(url, { token, method = "POST", bodyObj }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    Origin: FLOW_ORIGIN,
    Referer: FLOW_REFERER,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  // Try parse JSON if possible
  let json = null;
  if (contentType.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } else {
    // Sometimes upstream returns JSON but wrong content-type
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    contentType,
    text,
    json,
  };
}

// ===== Health =====
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "VictorSharp Flow Veo3 Proxy" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ===== API =====

// 1) Validate token format / reachability (lightweight)
app.post("/api/flow/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  logEvent("FLOW_VALIDATE", {
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    path: req.path,
    hasAuth: !!token,
  });

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <access_token>" });
  }

  // Minimal validation: call status endpoint with a fake id just to see if it blocks immediately.
  // If upstream requires different validation endpoint, you can change logic later.
  try {
    const testUrl = `${FLOW_VEO_STATUS_URL}/__test__`;
    const upstream = await fetchUpstream(testUrl, { token, method: "GET" });

    // If upstream returns 401/403 -> token likely invalid/expired.
    // If upstream returns 404 -> endpoint reachable but job not found (this is acceptable).
    if (upstream.status === 401 || upstream.status === 403) {
      return res.status(401).json({
        ok: false,
        error: "Token rejected by upstream (401/403). Token may be expired/invalid.",
        upstreamStatus: upstream.status,
      });
    }

    return res.json({
      ok: true,
      message: "Session Valid (token accepted or endpoint reachable).",
      upstreamStatus: upstream.status,
      upstreamContentType: upstream.contentType,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Validate failed (proxy error).",
      detail: String(e?.message || e),
    });
  }
});

// 2) Create video job
app.post("/api/flow/veo/generate", async (req, res) => {
  const token = getBearerToken(req);
  logEvent("FLOW_VEO_GENERATE", {
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    path: req.path,
    bodyBytes: Number(req.headers["content-length"] || 0),
    hasAuth: !!token,
  });

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <access_token>" });
  }

  // Pass through whatever frontend sends (prompt, aspect ratio, duration, images, etc.)
  const payload = req.body || {};

  try {
    const upstream = await fetchUpstream(FLOW_VEO_GENERATE_URL, {
      token,
      method: "POST",
      bodyObj: payload,
    });

    if (!upstream.ok) {
      // Return a clear error with a snippet (first 800 chars)
      const snippet = (upstream.text || "").slice(0, 800);
      return res.status(upstream.status).json({
        ok: false,
        error: "Flow generate failed",
        upstreamStatus: upstream.status,
        upstreamContentType: upstream.contentType,
        upstreamSnippet: snippet,
        // If upstream JSON exists, include it too
        upstreamJson: upstream.json || null,
      });
    }

    // If upstream returns JSON, send it. Otherwise send text.
    if (upstream.json) return res.json(upstream.json);
    return res.json({ ok: true, raw: upstream.text });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Proxy generate crashed",
      detail: String(e?.message || e),
    });
  }
});

// 3) Poll job status
app.get("/api/flow/veo/status/:jobId", async (req, res) => {
  const token = getBearerToken(req);
  const { jobId } = req.params;

  logEvent("FLOW_VEO_STATUS", {
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    path: req.path,
    jobId,
    hasAuth: !!token,
  });

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <access_token>" });
  }

  try {
    const upstream = await fetchUpstream(`${FLOW_VEO_STATUS_URL}/${encodeURIComponent(jobId)}`, {
      token,
      method: "GET",
    });

    if (!upstream.ok) {
      const snippet = (upstream.text || "").slice(0, 800);
      return res.status(upstream.status).json({
        ok: false,
        error: "Flow status failed",
        upstreamStatus: upstream.status,
        upstreamContentType: upstream.contentType,
        upstreamSnippet: snippet,
        upstreamJson: upstream.json || null,
      });
    }

    if (upstream.json) return res.json(upstream.json);
    return res.json({ ok: true, raw: upstream.text });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Proxy status crashed",
      detail: String(e?.message || e),
    });
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`VictorSharp Flow Veo3 Proxy running on port ${PORT}`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
  console.log(`Upstream generate: ${FLOW_VEO_GENERATE_URL}`);
  console.log(`Upstream status:   ${FLOW_VEO_STATUS_URL}`);
});
