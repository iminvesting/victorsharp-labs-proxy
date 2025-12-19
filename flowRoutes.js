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
 * HÀM GỌI GOOGLE (Giả lập trình duyệt chuẩn 2024)
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
    "Sec-Fetch-Site": "same-origin",
    "Priority": "u=1, i"
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
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}

    console.log(`📥 [KẾT QUẢ] Status: ${response.status}`);
    
    const isRedirect = response.status === 302 || response.status === 301;
    const isHtml = text.trim().startsWith("<!DOCTYPE html") || text.includes("<html");

    return { 
      ok: response.ok && !isHtml && !isRedirect, 
      status: response.status, 
      data: json, 
      raw: text, 
      isHtml: isHtml || isRedirect 
    };
  } catch (err) {
    console.error("🔥 [LỖI]:", err.message);
    return { ok: false, status: 504, error: err.message };
  }
}

// 1. CHECK SESSION
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token!" });
  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  res.status(result.status).json(result.data || { ok: result.ok });
});

// 2. TẠO VIDEO (DÒ TÌM ENDPOINT MỚI NHẤT)
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token trống!" });

  console.log("📦 App Web gửi qua:", JSON.stringify(req.body, null, 2));

  const payload = { ...req.body };
  delete payload.session;
  delete payload.access_token;
  delete payload.token;

  // DANH SÁCH 10 "NHÀ" MỚI NHẤT CỦA GOOGLE LABS (VEO3/FLOW)
  const candidates = [
    "https://labs.google/fx/api/v1/video:generate",     // Kiểu dùng dấu : (Rất phổ biến gần đây)
    "https://labs.google/fx/api/v1/video/generate",    // Kiểu v1 chuẩn
    "https://labs.google/fx/api/v1/tasks:generate",    // Kiểu Task vụ
    "https://labs.google/fx/api/v1/jobs:generate",     // Kiểu Job vụ
    "https://labs.google/fx/api/v1/veo:generate",      // Dành riêng cho Veo
    "https://labs.google/fx/api/v1/veo/generate",      // Dành riêng cho Veo (kiểu /)
    "https://labs.google/fx/api/video/generate",       // Cái cũ
    "https://labs.google/fx/api/generate"              // Rút gọn
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    
    if (result.ok) {
      console.log(`✅ TRÚNG RỒI! Link chuẩn là: ${url}`);
      return res.json(result.data); 
    }
    lastResult = result;
    if (result.status === 401) break; 
  }

  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Google báo lỗi 404 (Không tìm thấy link API).",
    msg: "Google đã dời 'nhà' API rồi anh ơi. Coi log Render gửi em nhen!",
    details: lastResult?.data || "Google trả về HTML (Redirect)."
  });
});

// 3. CHECK STATUS
router.get("/video/status/:jobId", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.params.jobId;
    if (!token || !jobId) return res.status(400).json({ ok: false, error: "Thiếu ID/Token" });

    const statusUrls = [
        `https://labs.google/fx/api/v1/video/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/v1/tasks/${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/v1/jobs/${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/video/status?jobId=${encodeURIComponent(jobId)}`
    ];

    for (const url of statusUrls) {
        const result = await callGoogleLabs(url, "GET", token);
        if (result.ok) return res.json({ ok: true, data: result.data });
    }
    res.status(502).json({ ok: false, error: "Hổng lấy được trạng thái." });
});

export default router;
