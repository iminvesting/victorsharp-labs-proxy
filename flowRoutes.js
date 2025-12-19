import express from "express";

const router = express.Router();

/**
 * HÀM TRÍCH XUẤT TOKEN (ya29...)
 * Hỗ trợ bóc tách từ Header Authorization hoặc Body (JSON/String)
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
 * HÀM GỌI API GOOGLE (Helper)
 * Tự động thử nghiệm và bắt lỗi 404/502
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [GỬI ĐI] ${method} -> ${url}`);
  
  const options = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FlowProxy/V5"
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

    return { ok: response.ok && !isHtml, status: response.status, data: json, raw: text, isHtml };
  } catch (err) {
    console.error("🔥 [LỖI KẾT NỐI]:", err.message);
    return { ok: false, status: 504, error: err.message };
  }
}

// ---------- 1. KIỂM TRA SESSION (Dùng cho nút Check Auth) ----------
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token ya29!" });

  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  res.status(result.status).json(result.data || { ok: result.ok });
});

// ---------- 2. TẠO VIDEO (Nơi anh đang bị 404) ----------
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Token hổng có, sao tạo video nè!" });

  const payload = { ...req.body };
  delete payload.session;
  delete payload.access_token;

  // Danh sách các link Google có khả năng chạy (Tự động dò link đúng)
  const candidates = [
    "https://labs.google/fx/api/v1/video/generate", // Phương án v1 mới nhất
    "https://labs.google/fx/api/generate",          // Phương án rút gọn
    "https://labs.google/fx/api/video/generate"     // Link cũ (cái anh bị 404)
  ];

  let lastResult = null;
  for (const url of candidates) {
    const result = await callGoogleLabs(url, "POST", token, payload);
    if (result.ok) {
      console.log(`✅ TRÚNG RỒI! Đã tạo thành công tại: ${url}`);
      return res.json(result.data); 
    }
    lastResult = result;
    if (result.status === 401) break; // Token sai thì khỏi thử link khác
  }

  res.status(lastResult?.status || 502).json({
    ok: false,
    error: "Google từ chối hoặc link đã đổi (404/502).",
    details: lastResult?.data || "Coi log trên Render nhen anh!"
  });
});

// ---------- 3. KIỂM TRA TRẠNG THÁI (STATUS) ----------
// Khớp với App Web gọi GET /api/flow/video/status/ID_CUA_ANH
router.get("/video/status/:jobId", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.params.jobId;

    if (!token || !jobId) return res.status(400).json({ ok: false, error: "Thiếu ID hoặc Token!" });

    const statusUrls = [
        `https://labs.google/fx/api/v1/video/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/status?jobId=${encodeURIComponent(jobId)}`,
        `https://labs.google/fx/api/video/status?jobId=${encodeURIComponent(jobId)}`
    ];

    for (const url of statusUrls) {
        const result = await callGoogleLabs(url, "GET", token);
        if (result.ok) return res.json({ ok: true, data: result.data });
    }
    res.status(502).json({ ok: false, error: "Hổng lấy được trạng thái video." });
});

// Dự phòng cho trường hợp app cũ gọi POST
router.post("/video/status", async (req, res) => {
    const token = extractToken(req);
    const jobId = req.body?.jobId || req.body?.id || req.query?.jobId;
    if (!jobId) return res.status(400).json({ ok: false, error: "Missing JobId" });
    res.redirect(307, `/api/flow/video/status/${jobId}`);
});

export default router;
