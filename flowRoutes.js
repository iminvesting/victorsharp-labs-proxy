// flowRoutes.js (ESM) - FULL
import express from "express";

const router = express.Router();

// ===== Helpers =====
function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const s = String(h);
  if (!s.toLowerCase().startsWith("bearer ")) return null;
  return s.slice(7).trim();
}

async function readUpstreamBody(resp) {
  const ct = resp.headers.get("content-type") || "";
  const text = await resp.text();

  // Try JSON first if content-type is json
  if (ct.includes("application/json")) {
    try {
      return { parsed: JSON.parse(text), raw: text, isJson: true };
    } catch {
      return { parsed: null, raw: text, isJson: false };
    }
  }

  // Otherwise try parse JSON anyway
  try {
    return { parsed: JSON.parse(text), raw: text, isJson: true };
  } catch {
    return { parsed: null, raw: text, isJson: false };
  }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ENV: ${name}`);
  return v;
}

// ===== Health =====
router.get("/health", (req, res) => {
  res.json({ ok: true, service: "flow-backend" });
});

// ===== Session validate =====
router.post("/session/validate", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  try {
    // Google Labs session validate endpoint (fixed)
    const upstream = "https://labs.google/fx/api/auth/session";
    const resp = await fetch(upstream, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({}),
    });

    const body = await readUpstreamBody(resp);
    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Session validate failed",
        upstream,
        upstreamStatus: resp.status,
        upstreamBody: body.raw?.slice(0, 3000),
      });
    }

    return res.json({ ok: true, ...body.parsed });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ===== Core forwarders =====
// NOTE: We forward to ENV URLs EXACTLY (no extra "/fx" added)
async function forwardGenerate(req, res) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });

  let upstream;
  try {
    upstream = requireEnv("FLOW_VEO_GENERATE_URL");
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const payload = req.body ?? {};
    const resp = await fetch(upstream, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await readUpstreamBody(resp);

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: `Create Job Failed (${resp.status})`,
        upstream,
        upstreamBody: body.raw?.slice(0, 3000),
      });
    }

    // Return upstream json as-is
    return res.status(200).json(body.parsed ?? { ok: true, raw: body.raw });
  } catch (e) {
    return res.status(500).json({ error: `Proxy generate error: ${String(e?.message || e)}`, upstream });
  }
}

async function forwardStatus(req, res) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });

  let base;
  try {
    base = requireEnv("FLOW_VEO_STATUS_URL");
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const jobId = req.params.jobId;
  const upstream = `${base.replace(/\/+$/, "")}/${encodeURIComponent(jobId)}`;

  try {
    const resp = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const body = await readUpstreamBody(resp);

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: `Status Failed (${resp.status})`,
        upstream,
        upstreamBody: body.raw?.slice(0, 3000),
      });
    }

    return res.status(200).json(body.parsed ?? { ok: true, raw: body.raw });
  } catch (e) {
    return res.status(500).json({ error: `Proxy status error: ${String(e?.message || e)}`, upstream });
  }
}

// ===== Routes (support BOTH veo/* and video/*) =====
router.post("/veo/generate", forwardGenerate);
router.get("/veo/status/:jobId", forwardStatus);

router.post("/video/generate", forwardGenerate);
router.get("/video/status/:jobId", forwardStatus);

export default router;
