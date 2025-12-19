import express from "express";

const router = express.Router();

/**
 * HÀM TRÍCH XUẤT TOKEN (ya29...)
 * Hỗ trợ: Header Authorization, Body JSON, hoặc chuỗi String thuần.
 */
function extractToken(req) {
  // 1. Kiểm tra trong Header Authorization (Cách chuẩn nhất)
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  // 2. Kiểm tra trong Body
  const body = req.body || {};
  let tokenRaw = body.session || body.access_token || body.flowSession || body.token;

  if (!tokenRaw) {
    // Nếu cả body là một chuỗi token (plain text)
    if (typeof req.body === "string" && req.body.startsWith("ya29.")) return req.body.trim();
    return "";
  }

  // Nếu token là một object (trường hợp dán nguyên JSON vào app)
  if (typeof tokenRaw === "object" && tokenRaw !== null) {
    return tokenRaw.access_token || tokenRaw.session || "";
  }

  // Nếu là chuỗi JSON string, thử parse nó ra
  if (typeof tokenRaw === "string" && tokenRaw.startsWith("{")) {
    try {
      const parsed = JSON.parse(tokenRaw);
      return parsed.access_token || parsed.session || tokenRaw;
    } catch (e) {
      return tokenRaw;
    }
  }

  return tokenRaw.toString().trim();
}

/**
 * HÀM GỌI API GOOGLE (Helper)
 * Chuyên trị việc bắt tay với Google Labs và log lỗi 502
 */
async function callGoogleLabs(url, method, token, payload = null) {
  console.log(`\n📡 [FORWARD] ${method} -> ${url}`);
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "VictorSharp-Flow-Proxy/2.0"
  };

  const options = {
    method,
    headers,
    body: (payload && method !== "GET") ? JSON.stringify(payload) : undefined
  };

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let json = null;
    
    try { json = JSON.parse(text); } catch (e) {}

    console.log(`📥 [RESPONSE] Status: ${response.status}`);
    
    // Nếu Google trả về HTML (Lỗi redirect/Link sai)
    const isHtml = text.trim().startsWith("<!DOCTYPE html") || text.includes("<html");
    if (isHtml) {
        console.error("❌ LỖI: Google trả về trang HTML thay vì JSON. Kiểm tra lại URL API.");
        return { ok: false, status: 502, error: "Google Labs trả về trang HTML (sai Endpoint)." };
    }

    return { ok: response.ok, status: response.status, data: json, raw: text };
  } catch (err) {
    console.error("🔥 [NETWORK_ERROR]:", err.message);
    return { ok: false, status: 504, error: "Hổng kết nối được tới Google Labs (Timeout)." };
  }
}

// ---------- 1. KIỂM TRA SESSION (VALIDATE) ----------
// App Web gọi: POST /api/flow/session/validate
router.post("/session/validate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Thiếu Token ya29 rồi đại ca!" });

  const result = await callGoogleLabs("https://labs.google/fx/api/auth/session", "GET", token);
  
  if (result.ok) {
    return res.json({ ok: true, valid: true, data: result.data });
  }
  res.status(result.status).json({ 
    ok: false, 
    error: "Token hết hạn hoặc không có quyền!", 
    details: result.data || "Unauthorized" 
  });
});

// ---------- 2. TẠO VIDEO (GENERATE) ----------
// App Web gọi: POST /api/flow/video/generate
router.post("/video/generate", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "Hổng có Token, sao em tạo video được!" });

  // Dọn dẹp payload: Chỉ giữ lại những gì Google cần
  const cleanBody = { ...req.body };
  delete cleanBody.session;
  delete cleanBody.access_token;
  delete cleanBody.flowSession;
  delete cleanBody.token;

  // Endpoint tạo Video của Flow
  const url = "https://labs.google/fx/api/video/generate";
  const result = await callGoogleLabs(url, "POST", token, cleanBody);

  if (result.ok) {
    return res.json({ ok: true, data: result.data });
  }

  // Nếu tạch, trả về chi tiết để anh coi Log trên Render là biết tại sao liền
  res.status(result.status || 502).json({
    ok: false,
    error: "Tạo Job Video thất bại (502)",
    upstreamStatus: result.status,
    upstreamBody: result.data || "Google từ chối yêu cầu (Kiểm tra Payload hoặc Token)."
  });
});

// ---------- 3. KIỂM TRA TRẠNG THÁI (STATUS) ----------
// App Web gọi: POST /api/flow/video/status
router.post("/video/status", async (req, res) => {
    const token = extractToken(req);
    // Lấy jobId từ body hoặc query
    const jobId = req.body?.jobId || req.body?.id || req.query?.jobId;

    if (!token || !jobId) {
        return res.status(400).json({ ok: false, error: "Thiếu Job ID hoặc Token rồi!" });
    }

    const url = `https://labs.google/fx/api/video/status?jobId=${encodeURIComponent(jobId)}`;
    const result = await callGoogleLabs(url, "GET", token);

    if (result.ok) {
        return res.json({ ok: true, data: result.data });
    }
    res.status(result.status).json({ ok: false, error: "Lỗi lấy trạng thái video", details: result.data });
});

export default router;
