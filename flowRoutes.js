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
 * HÀM GỌI API GOOGLE (Stealth Mode V7)
 * Cố gắng giả lập trình duyệt và bắt lỗi redirect 404
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [DÒ ĐƯỜNG] ${method} -> ${url}`);
  
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
    redirect: "manual" 
  };

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    const location = response.headers.get("location");
    
    console.log(`📥 [KẾT QUẢ] Status: ${response.status}`);
    
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

// 1. KIỂM TRA SESSION (CHECK AUTH)
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token!" });
  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  res.status(result.status).json(result.data || { ok: result.ok, redirect: result.redirectUrl });
});

// 2. TẠO VIDEO (DÒ TÌM ENDPOINT TOÀN DIỆN)
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token hổng có!" });

  const payload = { ...req.body };
  delete payload.session;
  delete payload.access_token;

  // DANH SÁCH 8 ENDPOINT TIỀM NĂNG NHẤT HIỆN TẠI
  const candidates = [
    "https://labs.google/fx/api/v1/video:generate",     // Bản v1 kiểu dấu hai chấm (Mới nhất)
    "https://labs.google/fx/api/v1/tasks:generate",    // Bản chạy theo Task
    "https://labs.google/fx/api/v1/jobs:generate",     // Bản chạy theo Job
    "https://labs.google/fx/api/v1/video/generate",    // Bản v1 gạch chéo
    "https://labs.google/fx/api/v1/generate",          // Bản rút gọn
    "https://labs.google/fx/api/v1/projects/default/video:generate", // Bản Project ngầm
    "https://labs.google/fx/api/video/generate",       // Bản cũ (anh bị 404)
    "https://labs.google/fx/api/generate"              // Bản gốc
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    if (result.ok) {
      console.log(`✅ THÀNH CÔNG! Đã tìm thấy link hoạt động: ${url}`);
      return res.json(result.data); 
    }
    lastResult = result;
    if (result.status === 401) break; 
  }

  // Báo lỗi chi tiết kèm nội dung HTML để anh nhìn thấy Google đuổi anh đi đâu
  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Google chặn Render (404/302).",
    google_says: lastResult?.isHtml ? lastResult.raw.slice(0, 500) : "Check log Render!",
    redirect: lastResult?.redirectUrl
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
