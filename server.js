import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

/**
 * SERVER CHÍNH - VICTORSHARP FLOW PROXY
 * Nhiệm vụ: Tiếp nhận yêu cầu từ Web App và chuyển tiếp (forward) đến Google Labs.
 */

const app = express();

// Render mặc định dùng port 10000. Nếu chạy local sẽ dùng 3001.
const PORT = process.env.PORT || 10000;

// Cấu hình CORS: Cho phép mọi nguồn (origin) gọi vào để tránh lỗi trình duyệt
app.use(cors({
    origin: true,
    credentials: true,
}));

// Tăng giới hạn Payload (Cần thiết khi gửi ảnh/video nặng hoặc chuỗi base64)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Route kiểm tra trạng thái hoạt động của Proxy
app.get("/", (req, res) => {
    res.send("🚀 VictorSharp Flow Proxy đang trực chiến! Sẵn sàng tạo Video.");
});

// Gắn bộ xử lý logic API Flow vào đường dẫn /api/flow
app.use("/api/flow", flowRoutes);

// Xử lý khi người dùng gọi sai đường dẫn (404)
app.use((req, res) => {
    res.status(404).json({
        ok: false,
        error: "Hổng tìm thấy đường dẫn này anh ơi!",
        path: req.originalUrl
    });
});

// Bộ bắt lỗi hệ thống (Global Error Handler)
app.use((err, req, res, next) => {
    console.error("🔴 [SERVER_ERROR]:", err.stack);
    res.status(500).json({
        ok: false,
        error: "Proxy bị lỗi nội bộ rồi!",
        detail: err.message
    });
});

app.listen(PORT, () => {
    console.log(`\n-----------------------------------------`);
    console.log(`⭐ Server đang chạy tại Port: ${PORT}`);
    console.log(`⭐ Sẵn sàng nhận lệnh từ App Web của anh!`);
    console.log(`-----------------------------------------\n`);
});
