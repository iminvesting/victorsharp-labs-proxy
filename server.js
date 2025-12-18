// server.js (ESM)
// ✅ Works with package.json: { "type": "module" }

import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

const PORT = process.env.PORT || 10000;

// Trust proxy (Render)
app.set("trust proxy", 1);

// CORS (open, because this is a proxy service)
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Basic health + root
app.get("/", (_req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// Mount Flow API
app.use("/api/flow", flowRoutes);

// 404
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
  console.error("[SERVER_ERROR]", err);
  res.status(500).json({
    ok: false,
    error: "Internal Server Error",
    message: err?.message || String(err),
  });
});

app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
