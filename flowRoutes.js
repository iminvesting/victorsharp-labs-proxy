/* flowRoutes.js - CommonJS */
const express = require("express");
const router = express.Router();

// Node 18+ có fetch sẵn trên Render. Nếu môi trường thiếu fetch thì fallback:
const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const FLOW_BASE_URL = process.env.FLOW_BASE_URL || "https://labs.google/fx/api";

// Session validate (cái này bạn đang dùng OK)
const FLOW_SESSION_VALIDATE_URL =
  process.env.FLOW_SESSION_VALIDATE_URL ||
  `${FLOW_BASE_URL}/auth/session`;

/**
 * IMPORTANT:
 * Endpoint generate/status của labs.google/fx có thể thay đổi theo thời điểm/tài khoản.
 * Vì vậy mình cho proxy tự "dò" nhiều path và cache path chạy được.
 */
const GENERATE_CANDIDATES = [
  // phổ biến / dễ gặp
  `${FLOW_BASE_URL}/video/generate`,
  `${FLOW_BASE_URL}/veo/generate`,
  `${FLOW_BASE_URL}/veo3/generate`,
  `${FLOW_BASE_URL}/veo2/generate`,

  // một số biến thể khác
  `${FLOW_BASE_URL}/v1/video/generate`,
  `${FLOW_BASE_URL}/v1/veo/generate`,
  `${FLOW_BASE_URL}/v1/veo3/generate`,
];

const STATUS_CANDIDATES = [
  `${FLOW_BASE_URL}/video/status`,
  `${FLOW_BASE_URL}/veo/status`,
  `${FLOW_BASE_URL}/veo3/status`,
  `${FLOW_BASE_URL}/v1/video/status`,
  `${FLOW_BASE_URL}/v1/veo/status`,
];

let cachedGenerateUrl = null;
let cachedStatusBase = null;
let cacheTs = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút

function now() {
  return Date.now();
}

function isCacheValid() {
  return cachedGenerateUrl && cachedStatusBase && now() - cacheTs < CACHE_TTL_MS;
}

function setCache(genUrl, statusBase) {
  cachedGenerateUrl = genUrl;
  cachedStatusBase = statusBase;
  cacheTs = now();
}

function log(tag, data) {
  try {
    console.log(`[${tag}]`, JSON.stringify(data));
  } catch {
    console.log(`[${tag}]`, data);
  }
}

function safeSnippet(s, n = 500) {
  if (s == null) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function pickBearer(req) {
  // Ưu tiên header Authorization: Bearer ya29...
  const h = req.headers.authorization || req.headers.Authorization;
  if (h && /^Bearer\s+/i.test(h)) return h;

  // fallback: body.session hoặc body.access_token
  const token =
    (req.body && (req.body.session || req.body.access_token)) ||
    (req.query && (req.query.session || req.query.access_token));

  if (token) return `Bearer ${token}`;
  return null;
}

async function readUpstreamBody(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  if (ct.includes("application/json")) {
    try {
      return { kind: "json", data: JSON.parse(text) };
    } catch {
      return { kind: "text", data: text };
    }
  }
  // nếu trả HTML/404 page
  return { kind: "text", data: text };
}

function looksLikeHtml(bodyText) {
  const t = (bodyText || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

/** =========================
 * POST /api/flow/session/validate
 * Body: { session: "ya29..." }  OR { access_token: "ya29..." } OR raw string token in header
 * ========================= */
router.post("/session/validate", async (req, res) => {
  const bearer = pickBearer(req);

  log("FLOW_VALIDATE", {
    path: req.path,
    hasAuth: !!bearer,
    upstream: FLOW_SESSION_VALIDATE_URL,
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token> (ya29...)",
    });
  }

  try {
    const upstreamRes = await fetchFn(FLOW_SESSION_VALIDATE_URL, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json,text/plain,*/*",
      },
      // một số endpoint chỉ cần auth header, body có/không đều được
      body: JSON.stringify({}),
    });

    const body = await readUpstreamBody(upstreamRes);

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        ok: false,
        error: `Validate failed (${upstreamRes.status})`,
        upstream: FLOW_SESSION_VALIDATE_URL,
        upstreamStatus: upstreamRes.status,
        upstreamBody: body.kind === "json" ? body.data : safeSnippet(body.data, 4000),
      });
    }

    return res.status(200).json({
      ok: true,
      upstream: FLOW_SESSION_VALIDATE_URL,
      data: body.kind === "json" ? body.data : body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Validate failed (proxy fetch error)",
      upstream: FLOW_SESSION_VALIDATE_URL,
      detail: String(err?.message || err),
    });
  }
});

/**
 * Try POST generate candidates until one returns JSON OK (not HTML 404).
 */
async function tryGenerateCandidates(bearer, payload) {
  const tried = [];

  // nếu đã cache và còn hạn => dùng luôn
  if (isCacheValid()) {
    tried.push({ url: cachedGenerateUrl, cached: true });
    const r = await fetchFn(cachedGenerateUrl, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json,text/plain,*/*",
      },
      body: JSON.stringify(payload),
    });
    const b = await readUpstreamBody(r);
    // nếu cache chết thì rớt xuống dò lại
    if (r.ok) return { ok: true, url: cachedGenerateUrl, res: r, body: b, tried };
  }

  for (const url of GENERATE_CANDIDATES) {
    tried.push({ url });
    const r = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: bearer,
        "Content-Type": "application/json",
        Accept: "application/json,text/plain,*/*",
      },
      body: JSON.stringify(payload),
    });

    const b = await readUpstreamBody(r);

    // Nếu bị 404 và trả HTML => chắc chắn sai endpoint => thử tiếp
    if (r.status === 404 && b.kind === "text" && looksLikeHtml(b.data)) {
      continue;
    }

    // Nếu OK => cache lại (status base sẽ chọn sau)
    if (r.ok) {
      return { ok: true, url, res: r, body: b, tried };
    }

    // Nếu không OK nhưng không phải HTML-404, vẫn trả về để bạn thấy lỗi thật (quota/403/etc.)
    return { ok: false, url, res: r, body: b, tried };
  }

  // không tìm được endpoint nào
  return {
    ok: false,
    url: null,
    res: { status: 404 },
    body: { kind: "text", data: "All generate endpoints returned HTML 404 (not found)." },
    tried,
  };
}

/**
 * Try status base candidates for a given job id.
 */
async function tryStatusCandidates(bearer, id) {
  const tried = [];

  if (isCacheValid()) {
    const u = `${cachedStatusBase}/${encodeURIComponent(id)}`;
    tried.push({ url: u, cached: true });
    const r = await fetchFn(u, { method: "GET", headers: { Authorization: bearer } });
    const b = await readUpstreamBody(r);
    if (r.ok) return { ok: true, url: u, res: r, body: b, tried };
  }

  for (const base of STATUS_CANDIDATES) {
    const u = `${base}/${encodeURIComponent(id)}`;
    tried.push({ url: u });
    const r = await fetchFn(u, {
      method: "GET",
      headers: { Authorization: bearer, Accept: "application/json,text/plain,*/*" },
    });
    const b = await readUpstreamBody(r);

    if (r.status === 404 && b.kind === "text" && looksLikeHtml(b.data)) {
      continue;
    }
    if (r.ok) return { ok: true, url: u, res: r, body: b, tried };
    return { ok: false, url: u, res: r, body: b, tried };
  }

  return {
    ok: false,
    url: null,
    res: { status: 404 },
    body: { kind: "text", data: "All status endpoints returned HTML 404 (not found)." },
    tried,
  };
}

/** =========================
 * POST /api/flow/veo/generate  (alias: /video/generate)
 * ========================= */
async function handleGenerate(req, res) {
  const bearer = pickBearer(req);
  const payload = req.body || {};

  log("FLOW_GENERATE", {
    path: req.path,
    hasAuth: !!bearer,
    promptPreview: safeSnippet(payload?.prompt || "", 120),
  });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "Missing/invalid JSON body" });
  }

  try {
    const result = await tryGenerateCandidates(bearer, payload);

    // nếu ok => cache endpoint generate & status base “hợp logic” nhất
    if (result.ok) {
      // set cache: chọn status base theo generate path (heuristic)
      // vd: nếu generate là .../veo/generate => status base .../veo/status
      let statusBase = null;
      if (result.url.includes("/veo3/")) statusBase = `${FLOW_BASE_URL}/veo3/status`;
      else if (result.url.includes("/veo/")) statusBase = `${FLOW_BASE_URL}/veo/status`;
      else statusBase = `${FLOW_BASE_URL}/video/status`;

      setCache(result.url, statusBase);

      return res.status(200).json({
        ok: true,
        upstream: result.url,
        cached: true,
        tried: result.tried,
        data: result.body.kind === "json" ? result.body.data : result.body.data,
      });
    }

    // fail
    const status = result.res?.status || 502;
    return res.status(status).json({
      ok: false,
      error:
        status === 404
          ? "Create Job Failed (404) - No valid upstream endpoint matched"
          : `Create Job Failed (${status})`,
      upstream: result.url,
      upstreamStatus: status,
      tried: result.tried,
      upstreamBody:
        result.body.kind === "json"
          ? result.body.data
          : safeSnippet(result.body.data, 4000),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Flow generate failed (proxy fetch error)",
      detail: String(err?.message || err),
    });
  }
}

router.post("/veo/generate", handleGenerate);
router.post("/video/generate", handleGenerate);

/** =========================
 * GET /api/flow/veo/status/:id  (alias: /video/status/:id)
 * ========================= */
async function handleStatus(req, res) {
  const bearer = pickBearer(req);
  const id = req.params.id;

  log("FLOW_STATUS", { path: req.path, hasAuth: !!bearer, id });

  if (!bearer) {
    return res.status(401).json({
      ok: false,
      error: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  try {
    const result = await tryStatusCandidates(bearer, id);

    if (result.ok) {
      return res.status(200).json({
        ok: true,
        upstream: result.url,
        tried: result.tried,
        data: result.body.kind === "json" ? result.body.data : result.body.data,
      });
    }

    const status = result.res?.status || 502;
    return res.status(status).json({
      ok: false,
      error:
        status === 404
          ? "Status Failed (404) - No valid upstream endpoint matched"
          : `Status Failed (${status})`,
      upstream: result.url,
      upstreamStatus: status,
      tried: result.tried,
      upstreamBody:
        result.body.kind === "json"
          ? result.body.data
          : safeSnippet(result.body.data, 4000),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Flow status failed (proxy fetch error)",
      detail: String(err?.message || err),
    });
  }
}

router.get("/veo/status/:id", handleStatus);
router.get("/video/status/:id", handleStatus);

// Debug
router.get("/debug/env", (_req, res) => {
  res.json({
    ok: true,
    FLOW_BASE_URL,
    FLOW_SESSION_VALIDATE_URL,
    generateCandidates: GENERATE_CANDIDATES,
    statusCandidates: STATUS_CANDIDATES,
    cachedGenerateUrl,
    cachedStatusBase,
    cacheAgeMs: cacheTs ? now() - cacheTs : null,
  });
});

module.exports = router;
