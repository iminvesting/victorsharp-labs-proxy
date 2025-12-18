import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// CORS (AI Studio iframe + mọi origin)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Origin", "Accept"],
  })
);

// Logger
app.use((req, _res, next) => {
  console.log(`[INCOMING] ${req.method} ${req.originalUrl}`);
  next();
});

// Body lớn
app.use(express.json({ limit: "50mb" }));

// Health
app.get("/health", (_req, res) => {
  return res.status(200).json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// ✅ Route chuẩn
app.use("/api/flow", flowRoutes);

// ✅ “Chống lệch route” (fix case webapp gọi nhầm /api/flow/api/flow/*)
app.use("/api/flow/api/flow", flowRoutes);

// Root
app.get("/", (_req, res) => {
  res
    .status(200)
    .send(
      "VictorSharp Labs Proxy is running. Try GET /health or POST /api/flow/session/validate"
    );
});

// 404 fallback rõ ràng
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    hint: "Use POST /api/flow/session/validate, POST /api/flow/video/generate, POST /api/flow/video/status",
    path: req.originalUrl,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
