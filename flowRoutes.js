import express from "express";

const router = express.Router();

/**
 * HÀM RÚT TOKEN (ya29...)
 */
function extractToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();

  const body = req.body || {};
  let tokenRaw = body.session || body.access_token || body.flowSession || body.token;

  if (!tokenRaw) {
    if (typeof req.body === "string" && req.body.startsWith("ya29.")) return req.body.trim();
    return "";
  }

  if (typeof tokenRaw === "object" && tokenRaw !== null) {
    return tokenRaw.access_token || tokenRaw.session || "";
  }
  return tokenRaw.toString().trim();
}

/**
 * HÀM GỌI API GOOGLE (Phiên bản V9 - Khớp Referer chuẩn)
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [TARGET] ${method} -> ${url}`);
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Origin": "https://labs.google",
    "Referer": "https://labs.google/fx/tools/flow", // Google bắt buộc phải có cái này mới né được 404
    "X-Goog-Authuser": "0",
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: (payload && method !== "GET") ? JSON.stringify(payload) : undefined,
      redirect: "manual"
    });

    const text = await response.text();
    console.log(`📥 [STATUS] ${response.status}`);

    const isHtml = text.trim().startsWith("<!DOCTYPE html") || text.includes("<html");
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}

    return { 
      ok: response.ok && !isHtml, 
      status: response.status, 
      data: json, 
      raw: text, 
      isHtml 
    };
  } catch (err) {
    console.error("🔥 [FETCH_ERROR]:", err.message);
    return { ok: false, status: 504, error: err.message };
  }
}

// 1. KIỂM TRA SESSION
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token!" });
  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  res.status(result.status).json(result.data || { ok: result.ok });
});

// 2. TẠO VIDEO (THỬ CÁC ENDPOINT ĐẶC BIỆT)
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token hổng có!" });

  console.log("📦 App Web gửi qua:", JSON.stringify(req.body, null, 2));

  const payload = { ...req.body };
  delete payload.session;
  delete payload.access_token;

  // Danh sách các "nhà" tiềm năng của Video FX (Veo3)
  const candidates = [
    "https://labs.google/fx/api/v1/projects/default/tasks:generate", // Endpoint hiện đại nhất
    "https://labs.google/fx/api/v1/video:generate",
    "https://labs.google/fx/api/video/generate", 
    "https://labs.google/fx/api/generate"
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    
    // Nếu lỗi 400, thử bọc payload vào "input" (Google hay bắt làm vậy)
    if (result.status === 400) {
      const retry = await callGoogleLabs(url, "POST", token, { input: payload });
      if (retry.ok) return res.json(retry.data);
    }

    if (result.ok) {
      console.log(`✅ TRÚNG RỒI! Link hoạt động là: ${url}`);
      return res.json(result.data); 
    }
    lastResult = result;
    if (result.status === 401) break; 
  }

  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Google chặn hoặc link đã đổi (404/502).",
    google_raw: lastResult?.isHtml ? "Google trả về HTML (Redirect)" : lastResult?.raw
  });
});

// 3. CHECK STATUS
router.get("/video/status/:jobId", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.params.jobId;
    const url = `https://labs.google/fx/api/v1/projects/default/tasks/${encodeURIComponent(jobId)}`;
    const result = await callGoogleLabs(url, "GET", token);
    if (result.ok) return res.json({ ok: true, data: result.data });
    
    const oldUrl = `https://labs.google/fx/api/v1/video/status?jobId=${encodeURIComponent(jobId)}`;
    const oldRes = await callGoogleLabs(oldUrl, "GET", token);
    res.status(oldRes.status || 502).json(oldRes.data || { ok: oldRes.ok });
});

export default router;
