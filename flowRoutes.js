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
 * HÀM GỌI API GOOGLE (Nâng cấp giả lập trình duyệt)
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [GỬI ĐI] ${method} -> ${url}`);
  
  // LOG PAYLOAD KEYS ĐỂ DEBUG (Không in giá trị nhạy cảm)
  if (payload) {
    console.log(`📦 Payload Keys: [${Object.keys(payload).join(", ")}]`);
  }

  const options = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Origin": "https://labs.google",
      "Referer": "https://labs.google/fx/video",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: (payload && method !== "GET") ? JSON.stringify(payload) : undefined
  };

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}

    console.log(`📥 [PHẢN HỒI] Status: ${response.status}`);
    const isHtml = text.trim().startsWith("<!DOCTYPE html") || text.includes("<html");

    if (isHtml) {
        console.warn(`⚠️ Cảnh báo: Google trả về trang HTML tại ${url}. Đang thử link khác...`);
    }

    return { 
      ok: response.ok && !isHtml, 
      status: response.status, 
      data: json, 
      raw: text, 
      isHtml 
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

// ---------- 2. TẠO VIDEO (Cơ chế Dò tìm Tự động) ----------
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token hổng có!" });

  const payload = { ...req.body };
  // Dọn dẹp payload để Google hổng "chê"
  delete payload.session;
  delete payload.access_token;
  delete payload.token;

  // DANH SÁCH ENDPOINT CẬP NHẬT MỚI NHẤT
  const candidates = [
    "https://labs.google/fx/api/v1/video/generate", 
    "https://labs.google/fx/api/v1/generate",
    "https://labs.google/fx/api/video/generate", 
    "https://labs.google/fx/api/generate"
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    
    if (result.ok) {
      console.log(`✅ THÀNH CÔNG! Link chuẩn là: ${url}`);
      return res.json(result.data); 
    }
    lastResult = result;
    
    // Nếu lỗi 401 (Hết hạn token) thì dừng luôn cho đỡ tốn tài nguyên
    if (result.status === 401) break; 
  }

  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Tất cả các đường link của Google đều báo lỗi (404/502).",
    details: lastResult?.data || "Vui lòng xem log trên Render để biết Google chê cái gì nhen!"
  });
});

// ---------- 3. KIỂM TRA TRẠNG THÁI (STATUS) ----------
router.get("/video/status/:jobId", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.params.jobId;

    if (!token || !jobId) return res.status(400).json({ ok: false, error: "Thiếu ID hoặc Token!" });

    const statusUrls = [
        `https://labs.google/fx/api/v1/video/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/v1/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/video/status?jobId=${encodeURIComponent(jobId)}`
    ];

    for (const url of statusUrls) {
        const result = await callGoogleLabs(url, "GET", token);
        if (result.ok) return res.json({ ok: true, data: result.data });
    }
    res.status(502).json({ ok: false, error: "Hổng lấy được trạng thái video." });
});

// Dự phòng POST
router.post("/video/status", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.body?.jobId || req.body?.id || req.query?.jobId;
    if (!jobId) return res.status(400).json({ ok: false, error: "Missing JobId" });
    res.redirect(307, `./status/${jobId}`);
});

export default router;
