// server.js (ESM)
// NOTE: Project uses "type": "module" => must use import, NOT require

import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// If behind Render/Proxy
app.set("trust proxy", 1);

// CORS (allow app web / aistudio / local)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parser
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Root
app.get("/", (_req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// Mount Flow routes
app.use("/api/flow", flowRoutes);

// 404 JSON
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    method: req.method,
    path: req.originalUrl,
  });
});

// Error handler
app.use((err, _req, res, _next) => {
  res.status(500).json({
    ok: false,
    error: "Server Error",
    detail: String(err?.message || err),
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
