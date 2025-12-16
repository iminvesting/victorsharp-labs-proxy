// server.js — VictorSharp Flow Veo3 Proxy (Render)
// ESM: package.json should include: { "type": "module" }

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 10000;

// Upstream endpoints (set in Render → Environment)
const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL ||
  "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://aisandbox-pa.googleapis.com/v1/operations";

// ---------- helpers ----------
function pickAuth(req) {
  const h = req.headers.authorization || "";
  // expect: "Bearer ya29...."
  return h.startsWith("Bearer ") ? h : "";
}

async function readUpstreamBody(resp) {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return { json: await resp.json(), text: null };
    } catch {
      // fall through
    }
  }
  const text = await resp.text().catch(() => "");
  return { json: null, text };
}

function snippet(s, n = 600) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function normalizeOperationPath(op) {
  // Accept formats:
  // - "operations/xxx"
  // - "v1/operations/xxx"
  // - full URL "https://.../v1/operations/xxx"
  if (!op) return "";
  if (op.startsWith("http://") || op.startsWith("https://")) return op;
  if (op.startsWith("/")) op = op.slice(1);
  if (op.startsWith("v1/operations/")) return `${FLOW_VEO_STATUS_URL}/${op.replace("v1/operations/", "")}`;
  if (op.startsWith("operations/")) return `${FLOW_VEO_STATUS_URL}/${op.replace("operations/", "")}`;
  return `${FLOW_VEO_STATUS_URL}/${op}`;
}

// ---------- routes ----------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// NOTE: validate is POST (so browser GET will show Cannot GET — normal)
app.post("/api/flow/session/validate", async (req, res) => {
  const auth = pickAuth(req);
  const ok = Boolean(auth);
  // If you want a "real" validation, you can call upstream here,
  // but many times just checking token presence is enough.
  res.json({ ok, hasAuth: ok });
});

// Create job (forward to upstream)
app.post("/api/flow/veo/generate", async (req, res) => {
  const auth = pickAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });

  // Forward *exact* payload from client
  const payload = req.body ?? {};

  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    // mimic browser-ish headers (often helps)
    "User-Agent": "VictorSharp-FlowProxy/1.0",
  };

  console.log(
    JSON.stringify({
      tag: "FLOW_VEO_GENERATE",
      ts: new Date().toISOString(),
      path: req.path,
      bodyBytes: JSON.stringify(payload).length,
      upstream: FLOW_VEO_GENERATE_URL,
      hasAuth: true,
    })
  );

  let upstreamResp;
  try {
    upstreamResp = await fetch(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "manual",
    });
  } catch (e) {
    console.error("[FLOW_VEO_GENERATE] fetch error:", e?.message || e);
    return res.status(502).json({ ok: false, error: "Upstream fetch failed", detail: String(e?.message || e) });
  }

  const { json, text } = await readUpstreamBody(upstreamResp);
  const ct = upstreamResp.headers.get("content-type") || "";

  if (!upstreamResp.ok) {
    const upstreamSnippet = snippet(text || (json ? JSON.stringify(json) : ""), 900);
    console.error(
      JSON.stringify({
        tag: "FLOW_VEO_GENERATE_FAIL",
        ts: new Date().toISOString(),
        upstreamStatus: upstreamResp.status,
        upstreamContentType: ct,
        upstreamSnippet,
      })
    );
    return res.status(502).json({
      ok: false,
      error: "Flow generate failed",
      upstreamStatus: upstreamResp.status,
      upstreamContentType: ct,
      upstreamSnippet,
      upstreamJson: json,
    });
  }

  // success passthrough
  return res.status(200).json({ ok: true, upstream: json ?? { raw: text } });
});

// Poll operation status
app.get("/api/flow/veo/status/:op", async (req, res) => {
  const auth = pickAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });

  const op = req.params.op;
  const url = normalizeOperationPath(op);

  console.log(
    JSON.stringify({
      tag: "FLOW_VEO_STATUS",
      ts: new Date().toISOString(),
      op,
      url,
    })
  );

  let upstreamResp;
  try {
    upstreamResp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: auth,
        "User-Agent": "VictorSharp-FlowProxy/1.0",
      },
      redirect: "manual",
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "Upstream fetch failed", detail: String(e?.message || e) });
  }

  const { json, text } = await readUpstreamBody(upstreamResp);
  const ct = upstreamResp.headers.get("content-type") || "";

  if (!upstreamResp.ok) {
    return res.status(502).json({
      ok: false,
      error: "Flow status failed",
      upstreamStatus: upstreamResp.status,
      upstreamContentType: ct,
      upstreamSnippet: snippet(text || (json ? JSON.stringify(json) : ""), 900),
      upstreamJson: json,
    });
  }

  return res.json({ ok: true, upstream: json ?? { raw: text } });
});

app.listen(PORT, () => {
  console.log(`VictorSharp Flow Veo3 Proxy running on port ${PORT}`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
  console.log(`Upstream generate: ${FLOW_VEO_GENERATE_URL}`);
  console.log(`Upstream status: ${FLOW_VEO_STATUS_URL}`);
});
