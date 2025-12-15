# VictorSharp Flow Veo3 Backend Proxy (Render)

Backend proxy public HTTPS dùng cho **VictorSharp Web App (AI Studio Preview / Web App)** khi tích hợp **Flow Veo3**.

---

## 🎯 Mục đích

Web App **KHÔNG gọi trực tiếp Google Flow Veo3** vì:

- Bị **CORS**
- Không thể bảo mật Bearer token
- AI Studio Preview **không hỗ trợ localhost**

👉 Backend Proxy này chịu trách nhiệm:

- Nhận request từ Web App
- Inject `Authorization: Bearer <access_token>`
- Forward request sang **Google Labs / Flow Veo3**
- Xử lý **jobId + polling status**
- Cho phép Web App chạy ổn định trên **AI Studio Preview / Web hosting**

---

## 🧱 Kiến trúc hệ thống

