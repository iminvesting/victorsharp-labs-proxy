/**
 * server.js
 * VictorSharp Flow Proxy Backend (Render)
 * - GET  /health
 * - Mount /api/flow -> flowRoutes
 */

const express = require("express");
const cors = require("cors");

const flowRoutes = require("./flowRoutes");

const app = express();

// Trust proxy (Render/Cloudflare) + stable logs
app.set("trust proxy", true);

// CORS: allow from anywhere (AS preview domain, local, etc.)
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

// JSON body
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Small request logger (helps debug 404/route mismatch)
app.use((req, res, next) => {
  const t = new Date().toISOString();
  console.log(`[${t}] [INCOMING] ${req.method} ${req.path}`);
  next();
});

app.get("/", (req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// IMPORTANT: mount under /api/flow
app.use("/api/flow", flowRoutes);

// 404 fallback (so you can see which path is missing)
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.path,
    method: req.method,
    hint: "Check your frontend is calling /api/flow/<route> (not duplicated /api/flow/api/flow).",
  });
});

// Global error handler
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
