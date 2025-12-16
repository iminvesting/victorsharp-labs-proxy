// server.js — VictorSharp Flow Veo3 Backend Proxy (Render)
// ESM (package.json: "type": "module")

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// =======================
// Config (override in Render -> Environment)
// =======================
// IMPORTANT:
// - Upstream endpoints may change. Always keep them configurable via ENV.
// - If you see 404 + HTML from labs.google/fx => upstream URL is wrong.

const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/veo/generate";

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/veo/status"; // + /:jobId

const FLOW_SESSION_URL =
  process.env.FLOW_SESSION_URL || "https://labs.google/fx/api/auth/session";

// =======================
// Middleware
// =======================
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Basic root
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "VictorSharp Flow Veo3 Proxy" });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// =======================
// Helpers
// =======================
function nowIso() {
  return new Date().toISOString();
}

function log(tag, extra = {}) {
  // Keep logs small (avoid dumping huge payloads)
  console.log(JSON.stringify({ tag, ts: nowIso(), ...extra }));
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  // Expect: "Bearer ya29...."
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function readUpstreamResponse(upRes) {
  const contentType = upRes.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    try {
      const json = await upRes.json();
      return { contentType, json, text: null };
    } catch (e) {
      const text = await upRes.text();
      return { contentType, json: null, text };
    }
  } else {
    const text = await upRes.text();
    return { contentType, json: null, text };
  }
}

function snippet(s, max = 500) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

// FLOW_VEO_STATUS_URL can be:
// 1) "https://.../operations"          => append "/{jobId}"
// 2) "https://.../operations/"         => append "{jobId}"
// 3) "https://.../operations/{jobId}"  => replace placeholder
// 4) "https://.../status"              => append "/{jobId}"
function buildStatusUrl(jobId) {
  if (!jobId) return FLOW_VEO_STATUS_URL;

  if (FLOW_VEO_STATUS_URL.includes("{jobId}")) {
    return FLOW_VEO_STATUS_URL.replace("{jobId}", encodeURIComponent(jobId));
  }

  // If already ends with "/" => just append
  if (FLOW_VEO_STATUS_URL.endsWith("/")) {
    return FLOW_VEO_STATUS_URL + encodeURIComponent(jobId);
  }

  return FLOW_VEO_STATUS_URL + "/" + encodeURIComponent(jobId);
}

// Extract a usable jobId from upstream json (many shapes)
function extractJobId(upJson) {
  if (!upJson || typeof upJson !== "object") return null;

  // Common patterns
  if (typeof upJson.jobId === "string") return upJson.jobId;
  if (typeof upJson.id === "string") return upJson.id;

  // Google long-running operation style
  if (typeof upJson.name === "string") return upJson.name; // often "operations/xxx"
  if (upJson.operation && typeof upJson.operation.name === "string") return upJson.operation.name;

  // Some APIs wrap it differently
  if (upJson.result && typeof upJson.result.name === "string") return upJson.result.name;

  return null;
}

// =======================
// API: Validate session
// =======================
app.post("/api/flow/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  log("FLOW_VALIDATE", { path: req.path, hasAuth: !!token });

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <access_token>" });
  }

  try {
    const upRes = await fetch(FLOW_SESSION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      redirect: "manual",
    });

    const { contentType, json, text } = await readUpstreamResponse(upRes);

    if (!upRes.ok) {
      return res.status(401).json({
        ok: false,
        error: "Session validate failed",
        upstreamStatus: upRes.status,
        upstreamContentType: contentType,
        upstreamJson: json || null,
        upstreamSnippet: snippet(text),
      });
    }

    return res.json({ ok: true, upstream: json || { ok: true } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Proxy error", message: String(e?.message || e) });
  }
});

// =======================
// API: Generate
// =======================
app.post("/api/flow/veo/generate", async (req, res) => {
  const token = getBearerToken(req);
  log("FLOW_VEO_GENERATE", { path: req.path, hasAuth: !!token, bodyBytes: JSON.stringify(req.body || {}).length });

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <access_token>" });
  }

  try {
    const upRes = await fetch(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(req.body || {}),
      redirect: "manual",
    });

    const { contentType, json, text } = await readUpstreamResponse(upRes);

    if (!upRes.ok) {
      return res.status(500).json({
        ok: false,
        error: "Flow generate failed",
        upstreamStatus: upRes.status,
        upstreamContentType: contentType,
        upstreamJson: json || null,
        upstreamSnippet: snippet(text),
        hint:
          upRes.status === 404 && (text || "").includes("labs.google/fx")
            ? "Upstream URL is wrong (you're hitting a web page). Set FLOW_VEO_GENERATE_URL in Render Environment."
            : undefined,
      });
    }

    const jobId = extractJobId(json);
    return res.json({ ok: true, jobId: jobId || null, upstream: json });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Proxy error", message: String(e?.message || e) });
  }
});

// =======================
// API: Status
// =======================
app.get("/api/flow/veo/status/:jobId", async (req, res) => {
  const token = getBearerToken(req);
  const jobId = req.params.jobId;

  log("FLOW_VEO_STATUS", { path: req.path, hasAuth: !!token, jobId });

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <access_token>" });
  }

  try {
    const url = buildStatusUrl(jobId);

    const upRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      redirect: "manual",
    });

    const { contentType, json, text } = await readUpstreamResponse(upRes);

    if (!upRes.ok) {
      return res.status(500).json({
        ok: false,
        error: "Flow status failed",
        upstreamStatus: upRes.status,
        upstreamContentType: contentType,
        upstreamJson: json || null,
        upstreamSnippet: snippet(text),
      });
    }

    return res.json({ ok: true, upstream: json || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Proxy error", message: String(e?.message || e) });
  }
});

// =======================
// Start
// =======================
app.listen(PORT, () => {
  console.log(`VictorSharp Flow Veo3 Proxy running on port ${PORT}`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
  console.log(`Upstream generate: ${FLOW_VEO_GENERATE_URL}`);
  console.log(`Upstream status:   ${FLOW_VEO_STATUS_URL}`);
});
