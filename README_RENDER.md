VictorSharp Flow Veo3 Backend Proxy (Render)

Backend proxy HTTPS public dùng cho VictorSharp Web App
(AI Studio Preview / Web App) khi bắt buộc tích hợp Google Flow Veo3.

====================================================================

1. MỤC ĐÍCH

Web App KHÔNG thể gọi trực tiếp Google Flow Veo3 vì:
- Bị CORS
- Không bảo mật được Bearer token
- AI Studio Preview KHÔNG hỗ trợ localhost

=> BẮT BUỘC phải có Backend Proxy public (HTTPS).

Backend Proxy có nhiệm vụ:
- Nhận request từ Web App
- Inject Authorization: Bearer <access_token>
- Forward request sang Google Labs / Flow Veo3
- Nhận jobId và hỗ trợ polling status

====================================================================

2. KIẾN TRÚC HỆ THỐNG

VictorSharp Web App (AI Studio / Web)
→ Backend Proxy (Render – HTTPS public)
→ Google Labs / Flow Veo3

Nguyên tắc:
- Web App chỉ gọi Backend
- Backend mới được phép gọi Flow Veo3
- KHÔNG dùng localhost trong Web App

====================================================================

3. FLOW VEO3 KEY (DÁN TRONG WEB APP)

Flow Veo3 Key phải dán dưới dạng JSON (KHÔNG phải file):

{
  "access_token": "ya29.xxxxxxxxxxxxxxxxx",
  "expires": "2025-12-16T05:01:50.000Z"
}

Giải thích:
- access_token: Bearer token dùng để gọi Flow Veo3
- expires: thời điểm token hết hạn

Khi token hết hạn:
- Chỉ cần dán JSON mới trong Web App
- KHÔNG cần sửa backend
- KHÔNG cần redeploy Render

====================================================================

4. BACKEND PROXY URL (BẮT BUỘC)

Web App phải gọi backend qua HTTPS public.

Ví dụ hợp lệ:
https://victorsharp-labs-proxy.onrender.com

KHÔNG dùng:
http://localhost:3001

Lý do:
- AI Studio Preview không gọi được localhost
- Trình duyệt sẽ block request

====================================================================

5. API ENDPOINTS BACKEND

Backend Proxy phải expose đúng các endpoint sau:

POST /api/flow/session/validate
POST /api/flow/veo/generate
GET  /api/flow/veo/status/:jobId

Luồng xử lý:
1. Web App gọi /session/validate
2. Web App gọi /veo/generate
3. Backend trả jobId
4. Web App polling /veo/status/:jobId
5. Khi completed → trả kết quả video

====================================================================

6. DEPLOY BACKEND TRÊN RENDER

Bước 1:
Push repo backend lên GitHub

Bước 2:
Vào https://render.com
→ New → Web Service
→ Connect GitHub repo

Bước 3:
Cấu hình Render:
- Runtime: Node
- Start command:
  npm start

Bước 4:
Deploy xong → copy URL dạng:
https://<service-name>.onrender.com

Ví dụ:
https://victorsharp-labs-proxy.onrender.com

====================================================================

7. CẤU HÌNH TRONG VICTORSHARP WEB APP

Trong CẤU HÌNH API (MULTI-AI):

- FLOW VEO3 KEY: dán JSON token
- BACKEND PROXY URL: dán URL Render
- Bấm CHECK AUTH

Nếu OK → có thể Generate Video (Flow Veo3)

====================================================================

8. CHECKLIST CUỐI

Trước khi debug lỗi, kiểm tra:

- Backend đã deploy HTTPS (Render)
- Web App KHÔNG dùng localhost
- Flow Key đúng JSON format
- Backend inject Authorization: Bearer
- Backend trả jobId + polling status
- Generate Video đi QUA backend

====================================================================

END OF FILE
