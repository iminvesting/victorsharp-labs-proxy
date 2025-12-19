import express from "express";

const router = express.Router();

/**
 * HÀM TRÍCH XUẤT TOKEN (ya29...)
 * Hỗ trợ bóc tách từ mọi định dạng (Header, Body JSON, String)
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
 * HÀM GỌI API GOOGLE (Giả lập siêu cấp né 404)
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [THỬ NGHIỆM] ${method} -> ${url}`);
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Origin": "https://labs.google",
    "Referer": "https://labs.google/fx/video",
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
    redirect: "manual" // Ngăn Google tự động đẩy về trang Login (gây ra 404 HTML)
  };

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}

    console.log(`📥 [KẾT QUẢ] Status: ${response.status}`);
    
    // Nếu là trang HTML hoặc bị Redirect thì link này không đúng
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
    console.error("🔥 [LỖI KẾT NỐI]:", err.message);
    return { ok: false, status: 504, error: err.message };
  }
}

// ---------- 1. KIỂM TRA SESSION ----------
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token ya29!" });
  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  res.status(result.status).json(result.data || { ok: result.ok });
});

// ---------- 2. TẠO VIDEO (CƠ CHẾ DÒ TÌM SÂU) ----------
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token hổng có!" });

  const payload = { ...req.body };
  // Dọn dẹp các trường không cần thiết cho Google
  delete payload.session;
  delete payload.access_token;
  delete payload.token;
  delete payload.flowSession;

  // DANH SÁCH CÁC ENDPOINT MỚI NHẤT CỦA GOOGLE LABS FX
  const candidates = [
    "https://labs.google/fx/api/v1/video/generate",    // Bản v1 mới nhất
    "https://labs.google/fx/api/v1/tasks/generate",    // Dạng Tasks mới
    "https://labs.google/fx/api/v1/generate",          // Bản v1 rút gọn
    "https://labs.google/fx/api/v1/jobs/create",       // Dạng Jobs mới
    "https://labs.google/fx/api/video/v1/generate",    // v1 nested
    "https://labs.google/fx/api/video/generate",       // Bản cũ (đang bị 404)
    "https://labs.google/fx/api/generate"              // Bản gốc
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    
    if (result.ok) {
      console.log(`✅ THÀNH CÔNG! Link hoạt động là: ${url}`);
      return res.json(result.data); 
    }
    lastResult = result;
    
    // Nếu token hết hạn (401) thì dừng ngay để anh biết mà thay token
    if (result.status === 401) break; 
  }

  // Nếu thử hết mà vẫn tạch
  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Tất cả các Endpoint của Google đều báo lỗi (404/502).",
    msg: "Vui lòng lấy lại Token ya29 mới nhất và kiểm tra lại Prompt.",
    lastStatus: lastResult?.status,
    details: lastResult?.data || "Google trả về HTML (Link bị sai hoặc Token bị logout)."
  });
});

// ---------- 3. KIỂM TRA TRẠNG THÁI ----------
router.get("/video/status/:jobId", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.params.jobId;
    if (!token || !jobId) return res.status(400).json({ ok: false, error: "Missing ID/Token" });

    const statusUrls = [
        `https://labs.google/fx/api/v1/video/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/v1/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/v1/tasks/${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/video/status?jobId=${encodeURIComponent(jobId)}`
    ];

    for (const url of statusUrls) {
        const result = await callGoogleLabs(url, "GET", token);
        if (result.ok) return res.json({ ok: true, data: result.data });
    }
    res.status(502).json({ ok: false, error: "Hổng lấy được trạng thái video." });
});

export default router;
