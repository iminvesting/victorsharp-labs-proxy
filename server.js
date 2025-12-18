/**
 * server.js - VictorSharp Flow Proxy Backend (Render)
 *
 * Endpoints:
 *   GET  /health
 *   POST /api/flow/session/validate
 *   POST /api/flow/video/generate
 */

const express = require("express");
const cors = require("cors");

const flowRoutes = require("./flowRoutes");

const app = express();
app.set("trust proxy", true);

// ---- CORS (Allow AIStudio preview + local + any) ----
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Flow-Session",
      "X-Flow-Cookie",
      "X-Flow-Token",
    ],
  })
);

// Always reply preflight
app.options("*", cors());

// ---- Body parsing ----
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ---- Simple request logger ----
app.use((req, res, next) => {
  const t = new Date().toISOString();
  console.log(`[${t}] [INCOMING] ${req.method} ${req.originalUrl}`);
  next();
});

app.get("/", (req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// IMPORTANT: routes live under /api/flow/*
app.use("/api/flow", flowRoutes);

// ---- 404 fallback (makes debugging easy) ----
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    hint:
      "Frontend must call /api/flow/<route> exactly once (avoid /api/flow/api/flow).",
  });
});

// ---- Global error handler ----
app.use((err, req, res, next) => {
  console.error("[SERVER_ERROR]", err);
  res.status(500).json({
    ok: false,
    error: err?.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
