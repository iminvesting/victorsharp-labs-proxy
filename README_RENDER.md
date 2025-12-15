# VictorSharp Flow Veo3 Backend Proxy (Render)

Backend proxy **public HTTPS** cho **VictorSharp Web App (AI Studio Preview / Web App)** sử dụng **Flow Veo3**.

---

## 🎯 Mục đích

- Web App **KHÔNG gọi trực tiếp** Google Flow Veo3 (do CORS + bảo mật).
- Backend Proxy chịu trách nhiệm:
  - Nhận request từ Web App
  - Inject **Authorization: Bearer access_token**
  - Forward request sang **Google Labs / Flow Veo3**
  - Xử lý **jobId + polling status**
- Cho phép Web App chạy ổn định trên **AI Studio Preview / Web hosting**.

---

## 🧱 Kiến trúc hệ thống

