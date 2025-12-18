import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

/**
 * CORS: Cho AI Studio iframe gọi được (origin có thể là aistudio.google.com)
 * Lưu ý: nếu bạn bật credentials thì origin không thể là '*'.
 * Ở đây ta để permissive nhất để debug ổn định.
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Origin", "Accept"],
  })
);

// Preflight
app.options("*", cors());

// Logger
app.use((req, _res, next) => {
  console.log(`[INCOMING] ${req.method} ${req.originalUrl}`);
  next();
});

// Body
app.use(express.json({ limit: "50mb" }));

/**
 * Health
 */
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

/**
 * API routes
 * ==> TẤT CẢ endpoint nằm dưới /api/flow/*
 */
app.use("/api/flow", flowRoutes);

/**
 * Fallback cho API (để khỏi trả HTML)
 */
app.all("/api/*", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    path: req.originalUrl,
    method: req.method,
  });
});

/**
 * Root
 */
app.get("/", (_req, res) => {
  res.status(200).send("victorsharp-labs-proxy is running. Use /health or /api/flow/*");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
