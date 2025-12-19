import express from "express";

const router = express.Router();

/**
 * HÀM TRÍCH XUẤT TOKEN (ya29...)
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
 * HÀM GỌI API GOOGLE (Stealth Mode V6)
 * Giả lập siêu sâu để né 404 Redirect
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [THỬ NGHIỆM] ${method} -> ${url}`);
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Origin": "https://labs.google",
    "Referer": "https://labs.google/fx/tools/flow",
    "X-Goog-Authuser": "0",
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };

  const options = {
    method,
    headers,
    body: (payload && method !== "GET") ? JSON.stringify(payload) : undefined,
    redirect: "manual" // Để mình bắt được lệnh 302 của Google
  };

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    const location = response.headers.get("location");
    
    console.log(`📥 [KẾT QUẢ] Status: ${response.status}`);
    if (location) console.log(`🔗 Redirect tới: ${location}`);

    const isRedirect = response.status === 302 || response.status === 301;
    const isHtml = text.trim().startsWith("<!DOCTYPE html") || text.includes("<html");

    let json = null;
    try { json = JSON.parse(text); } catch (e) {}

    return { 
      ok: response.ok && !isHtml && !isRedirect, 
      status: response.status, 
      data: json, 
      raw: text, 
      isHtml: isHtml || isRedirect,
      redirectUrl: location 
    };
  } catch (err) {
    console.error("🔥 [LỖI KẾT NỐI]:", err.message);
    return { ok: false, status: 504, error: err.message };
  }
}

// 1. KIỂM TRA SESSION
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token!" });
  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  res.status(result.status).json(result.data || { ok: result.ok, redirect: result.redirectUrl });
});

// 2. TẠO VIDEO (DÒ TÌM ĐA ĐIỂM)
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token hổng có!" });

  const payload = { ...req.body };
  delete payload.session;
  delete payload.access_token;

  const candidates = [
    "https://labs.google/fx/api/v1/video:generate",
    "https://labs.google/fx/api/v1/video/generate",
    "https://labs.google/fx/api/video/generate"
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    if (result.ok) return res.json(result.data);
    lastResult = result;
    if (result.status === 401) break;
  }

  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Tất cả link đều báo 404 (Google chặn Render).",
    redirected_to: lastResult?.redirectUrl,
    status: lastResult?.status
  });
});

// 3. CHECK STATUS
router.get("/video/status/:jobId", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.params.jobId;
    const url = `https://labs.google/fx/api/v1/video/status?jobId=${encodeURIComponent(jobId)}`;
    const result = await callGoogleLabs(url, "GET", token);
    if (result.ok) return res.json({ ok: true, data: result.data });
    res.status(result.status || 502).json({ ok: false, error: "Lỗi lấy trạng thái" });
});

export default router;
