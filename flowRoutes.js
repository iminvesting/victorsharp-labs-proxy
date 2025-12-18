/**
 * VictorSharp Labs Proxy - flowRoutes.js
 *
 * This file proxies Flow / Labs endpoints:
 *  - POST /api/flow/session/validate  -> https://labs.google/fx/api/auth/session
 *  - POST /api/flow/video/generate    -> https://labs.google/fx/api/video/generate
 *  - GET  /api/flow/health            -> local health
 *
 * IMPORTANT:
 * - /api/flow/session/validate is POST-only.
 * - Client should send JSON body: { session: "<token_or_json>" }
 */

import express from "express";

const router = express.Router();

// ---------- helpers ----------
function safeTrim(v) {
  return typeof v === "string" ? v.trim() : "";
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Accepts session either:
 * - string token (flow session)
 * - object json (if user pasted raw json)
 */
function normalizeSessionInput(session) {
  if (typeof session === "string") return safeTrim(session);
  if (isObject(session)) return session; // allow passing object
  return "";
}

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ ok: false, error, ...extra });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

/**
 * A single place to call Labs.
 * We forward UA + referer/origin to mimic browser requests better.
 */
async function callLabs(url, { method = "POST", headers = {}, body = null, timeoutMs = 45000 } = {}) {
  const baseHeaders = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    // mimic browser-ish headers
    "User-Agent":
      headers["User-Agent"] ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
    "Origin": headers["Origin"] || "https://labs.google",
    "Referer": headers["Referer"] || "https://labs.google/fx/tools/",
  };

  // Merge (caller overrides)
  const merged = { ...baseHeaders, ...headers };

  const resp = await fetchWithTimeout(
    url,
    {
      method,
      headers: merged,
      body: body ? JSON.stringify(body) : undefined,
    },
    timeoutMs
  );

  const contentType = resp.headers.get("content-type") || "";
  let dataText = "";
  let dataJson = null;

  // try json first
  if (contentType.includes("application/json")) {
    try {
      dataJson = await resp.json();
    } catch (e) {
      dataText = await resp.text().catch(() => "");
    }
  } else {
    dataText = await resp.text().catch(() => "");
    // sometimes returns json with wrong content-type
    try {
      dataJson = JSON.parse(dataText);
    } catch (_) {
      // ignore
    }
  }

  return {
    ok: resp.ok,
    status: resp.status,
    headers: Object.fromEntries(resp.headers.entries()),
    json: dataJson,
    text: dataText,
  };
}

// ---------- routes ----------

// quick health under /api/flow
router.get("/health", (req, res) => {
  res.status(200).json({ ok: true, route: "/api/flow/health", ts: Date.now() });
});

/**
 * Validate Flow session (POST only)
 * Body: { session: "<token>" } or { session: {...} }
 */
router.post("/session/validate", async (req, res) => {
  try {
    const session = normalizeSessionInput(req.body?.session);

    if (!session || (typeof session === "string" && session.length < 10)) {
      return jsonError(res, 400, "Missing or invalid session. Provide { session: <token or json> }");
    }

    console.log("[INCOMING] POST /api/flow/session/validate");
    console.log("[FLOW_VALIDATE] -> https://labs.google/fx/api/auth/session");

    const upstreamUrl = "https://labs.google/fx/api/auth/session";

    // upstream expects JSON; for string session we send { session: "<token>" }
    // for object session, pass it as-is (some users paste the raw json they copied)
    const payload = typeof session === "string" ? { session } : session;

    const upstream = await callLabs(upstreamUrl, {
      method: "POST",
      headers: {
        // forward some headers if present
        "User-Agent": req.headers["user-agent"] || undefined,
        "Origin": req.headers["origin"] || undefined,
        "Referer": req.headers["referer"] || undefined,
      },
      body: payload,
      timeoutMs: Number(process.env.FLOW_VALIDATE_TIMEOUT_MS || 45000),
    });

    if (!upstream.ok) {
      return res.status(200).json({
        ok: false,
        error: "Validate Session Failed",
        upstream: upstreamUrl,
        upstreamStatus: upstream.status,
        upstreamBody: upstream.json ?? upstream.text ?? null,
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: upstreamUrl,
      data: upstream.json ?? upstream.text ?? null,
    });
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Upstream timeout (AbortError)" : (err?.message || "Unknown error");
    console.error("[FLOW_VALIDATE_ERROR]", err);
    return res.status(200).json({
      ok: false,
      error: msg,
    });
  }
});

/**
 * Generate video (POST)
 * Body: { session: "<token>", ...payload }
 *
 * We forward the entire body to labs, but ensure session exists.
 */
router.post("/video/generate", async (req, res) => {
  try {
    const session = normalizeSessionInput(req.body?.session);
    if (!session || (typeof session === "string" && session.length < 10)) {
      return jsonError(res, 400, "Missing or invalid session. Provide session in request body.");
    }

    console.log("[INCOMING] POST /api/flow/video/generate");
    console.log("[FLOW_GENERATE] -> https://labs.google/fx/api/video/generate");

    const upstreamUrl = "https://labs.google/fx/api/video/generate";

    // Forward full payload
    const payload = { ...req.body, session: typeof session === "string" ? session : req.body.session };

    const upstream = await callLabs(upstreamUrl, {
      method: "POST",
      headers: {
        "User-Agent": req.headers["user-agent"] || undefined,
        "Origin": req.headers["origin"] || undefined,
        "Referer": req.headers["referer"] || undefined,
      },
      body: payload,
      timeoutMs: Number(process.env.FLOW_GENERATE_TIMEOUT_MS || 90000),
    });

    if (!upstream.ok) {
      return res.status(200).json({
        ok: false,
        error: "Create Job Failed",
        upstream: upstreamUrl,
        upstreamStatus: upstream.status,
        upstreamBody: upstream.json ?? upstream.text ?? null,
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: upstreamUrl,
      data: upstream.json ?? upstream.text ?? null,
    });
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Upstream timeout (AbortError)" : (err?.message || "Unknown error");
    console.error("[FLOW_GENERATE_ERROR]", err);
    return res.status(200).json({ ok: false, error: msg });
  }
});

// GET is not allowed for validate (helpful hint)
router.get("/session/validate", (req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body { session: <token or json> }",
  });
});

export default router;
