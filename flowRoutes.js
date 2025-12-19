import express from "express";

const router = express.Router();

/**
 * Accepts:
 * - raw token: "ya29...."
 * - JSON string: {"access_token":"ya29..."} or {"session":"ya29..."}
 * - object: {access_token:"ya29..."} or {session:"ya29..."}
 */
function extractToken(input) {
  if (!input) return "";

  // if already string token
  if (typeof input === "string") {
    const s = input.trim();
    if (s.startsWith("ya29.")) return s;

    // try parse JSON string
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        const obj = JSON.parse(s);
        return extractToken(obj);
      } catch {
        return s; // last resort
      }
    }
    return s;
  }

  // object
  if (typeof input === "object") {
    return (
      (input.access_token || input.session || input.token || input.bearer || "").toString().trim()
    );
  }

  return "";
}

function getBearerFromReq(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  return "";
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, text, json };
}

function flowHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    // Helps avoid some edge cases
    "User-Agent": "victorsharp-labs-proxy/1.0",
  };
}

// ---------- HEALTH CHECK ----------
router.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- VALIDATE FLOW SESSION ----------
router.post("/session/validate", async (req, res) => {
  try {
    const token =
      extractToken(req.body?.session) ||
      extractToken(req.body?.access_token) ||
      extractToken(req.body) ||
      getBearerFromReq(req);

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Missing Flow token. Paste only ya29.... (or JSON containing access_token).",
      });
    }

    // Validate endpoint (works for your flow session link)
    const upstream = "https://labs.google/fx/api/auth/session";

    const r = await fetchJson(upstream, {
      method: "GET",
      headers: flowHeaders(token),
    });

    if (!r.ok) {
      return res.status(400).json({
        ok: false,
        error: "Validate failed",
        upstream,
        upstreamStatus: r.status,
        upstreamBody: r.json || r.text,
      });
    }

    return res.json({
      ok: true,
      valid: true,
      upstream,
      // return small info only
      expires: r.json?.expires,
      user: r.json?.user ? { name: r.json.user.name, email: r.json.user.email } : undefined,
    });
  } catch (e) {
    console.error("[FLOW_VALIDATE_ERROR]", e);
    return res.status(500).json({ ok: false, error: e?.message || "Validate error" });
  }
});

// ---------- CREATE VIDEO (FLOW) ----------
router.post("/video/generate", async (req, res) => {
  try {
    const token =
      extractToken(req.body?.session) ||
      extractToken(req.body?.access_token) ||
      extractToken(req.body?.flowSession) ||
      getBearerFromReq(req);

    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing Flow token (ya29...)." });
    }

    // Payload from app (keep as-is)
    const payload = req.body || {};

    // Flow endpoints have changed a few times. Try best candidates in order.
    const candidates = [
      "https://labs.google/fx/api/video/generate",
      "https://labs.google/fx/fx/api/video/generate", // fallback (rare)
    ];

    let last = null;

    for (const upstream of candidates) {
      const r = await fetchJson(upstream, {
        method: "POST",
        headers: flowHeaders(token),
        body: payload,
      });

      last = { upstream, ...r };

      // If HTML returned => wrong endpoint, try next
      const looksLikeHtml =
        typeof r.text === "string" &&
        (r.text.trim().startsWith("<!DOCTYPE html") || r.text.includes("<html"));

      if (r.ok && !looksLikeHtml) {
        return res.json({
          ok: true,
          upstream,
          data: r.json ?? r.text,
        });
      }
    }

    // Failed all
    return res.status(502).json({
      ok: false,
      error: "Create job failed",
      upstream: last?.upstream,
      upstreamStatus: last?.status,
      upstreamBody: last?.json || last?.text,
    });
  } catch (e) {
    console.error("[FLOW_GENERATE_ERROR]", e);
    return res.status(500).json({ ok: false, error: e?.message || "Generate error" });
  }
});

// ---------- OPTIONAL: VIDEO STATUS/POLL ----------
router.post("/video/status", async (req, res) => {
  try {
    const token =
      extractToken(req.body?.session) ||
      extractToken(req.body?.access_token) ||
      extractToken(req.body?.flowSession) ||
      getBearerFromReq(req);

    const jobId = req.body?.jobId || req.body?.id || req.query?.jobId || req.query?.id;

    if (!token) return res.status(400).json({ ok: false, error: "Missing Flow token (ya29...)." });
    if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId." });

    const candidates = [
      `https://labs.google/fx/api/video/status?jobId=${encodeURIComponent(jobId)}`,
      `https://labs.google/fx/api/video/status?id=${encodeURIComponent(jobId)}`,
    ];

    let last = null;

    for (const upstream of candidates) {
      const r = await fetchJson(upstream, {
        method: "GET",
        headers: flowHeaders(token),
      });

      last = { upstream, ...r };

      const looksLikeHtml =
        typeof r.text === "string" &&
        (r.text.trim().startsWith("<!DOCTYPE html") || r.text.includes("<html"));

      if (r.ok && !looksLikeHtml) {
        return res.json({ ok: true, upstream, data: r.json ?? r.text });
      }
    }

    return res.status(502).json({
      ok: false,
      error: "Status check failed",
      upstream: last?.upstream,
      upstreamStatus: last?.status,
      upstreamBody: last?.json || last?.text,
    });
  } catch (e) {
    console.error("[FLOW_STATUS_ERROR]", e);
    return res.status(500).json({ ok: false, error: e?.message || "Status error" });
  }
});

export default router;
