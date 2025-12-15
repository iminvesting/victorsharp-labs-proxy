// server.js — VictorSharp Flow Veo3 Backend Proxy (Render) [HARDENED]
// ✅ Web App friendly (AI Studio / Web) — NO localhost dependency
// ✅ Uses Authorization: Bearer <access_token>
// ✅ Safe JSON parsing + timeouts + /health + real validate

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Optional: restrict CORS (leave "*" if you want simplest)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / server-to-server calls (no origin)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // allow all
      return cb(null, ALLOWED_ORIGINS.includes(origin));
    },
    credentials: false,
  })
);

app.use(express.json({ limit: "10mb" }));

/* =======================
   Config: Upstream URLs
   NOTE: If Flow changes paths, update these constants.
======================= */
const FLOW_BASE = "https://labs.google/fx/api";
const URL_AUTH_SESSION = `${FLOW_BASE}/auth/session`;
const URL_VEO_GENERATE = `${FLOW_BASE}/veo/generate`;
const URL_VEO_STATUS = (jobId) => `${FLOW_BASE}/veo/status/${encodeURIComponent(jobId)}`;

/* =======================
   Helpers
======================= */
function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(t) };
}

async function readJsonSafe(resp) {
  const text = await resp.text();
  try {
    return { ok: true, data: JSON.parse(text), raw: text };
  } catch {
    // not JSON (e.g., HTML 404 page)
    return { ok: false, data: null, raw: text };
  }
}

function logReq(tag, req, extra = {}) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(
    JSON.stringify({
      tag,
      ts: new Date().toISOString(),
      ip,
      path: req.path,
      ...extra,
    })
  );
}

/* =======================
   Health
======================= */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.json({ ok: true, service: "VictorSharp Flow Veo3 Proxy" }));

/* =======================
   Validate Flow Session (REAL CHECK)
   - Confirms Bearer token can access Flow session endpoint
======================= */
app.post("/api/flow/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  logReq("FLOW_VALIDATE", req);

  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });

  const { controller, clear } = withTimeout(15000);
  try {
    const resp = await fetch(URL_AUTH_SESSION, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    const parsed = await readJsonSafe(resp);

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Flow validate failed",
        status: resp.status,
        body: parsed.ok ? parsed.data : parsed.raw?.slice(0, 500),
      });
    }

    return res.json({
      ok: true,
      status: resp.status,
      // return minimal safe info (avoid leaking everything)
      session: parsed.ok ? parsed.data : { note: "non-json session response" },
    });
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Validate timeout" : String(err?.message || err);
    return res.status(504).json({ ok: false, error: msg });
  } finally {
    clear();
  }
});

/* =======================
   Generate Video (Veo)
   - Forwards payload to Flow
   - Returns upstream response (often contains jobId)
======================= */
app.post("/api/flow/veo/generate", async (req, res) => {
  const token = getBearerToken(req);
  logReq("FLOW_VEO_GENERATE", req, { bodyBytes: JSON.stringify(req.body || {}).length });

  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });
  if (!req.body) return res.status(400).json({ ok: false, error: "Missing request body" });

  const { controller, clear } = withTimeout(60000); // generate request can take time
  try {
    const resp = await fetch(URL_VEO_GENERATE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });

    const parsed = await readJsonSafe(resp);

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Flow generate failed",
        status: resp.status,
        body: parsed.ok ? parsed.data : parsed.raw?.slice(0, 800),
      });
    }

    // return upstream JSON if possible, else raw text
    return res.json(parsed.ok ? parsed.data : { ok: true, raw: parsed.raw });
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Generate timeout" : String(err?.message || err);
    return res.status(504).json({ ok: false, error: msg });
  } finally {
    clear();
  }
});

/* =======================
   Poll Status
======================= */
app.get("/api/flow/veo/status/:jobId", async (req, res) => {
  const token = getBearerToken(req);
  const jobId = req.params.jobId;
  logReq("FLOW_VEO_STATUS", req, { jobId });

  if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });
  if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId" });

  const { controller, clear } = withTimeout(30000);
  try {
    const resp = await fetch(URL_VEO_STATUS(jobId), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    const parsed = await readJsonSafe(resp);

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Flow status failed",
        status: resp.status,
        body: parsed.ok ? parsed.data : parsed.raw?.slice(0, 800),
      });
    }

    return res.json(parsed.ok ? parsed.data : { ok: true, raw: parsed.raw });
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Status timeout" : String(err?.message || err);
    return res.status(504).json({ ok: false, error: msg });
  } finally {
    clear();
  }
});

/* =======================
   Start
======================= */
app.listen(PORT, () => {
  console.log(`VictorSharp Flow Veo3 Proxy running on port ${PORT}`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
});
