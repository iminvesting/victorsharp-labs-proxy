/* server.js - CommonJS */
const express = require("express");
const cors = require("cors");

const flowRoutes = require("./flowRoutes");

const app = express();

// Render / proxies
app.set("trust proxy", 1);

// Body
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// CORS (cho webapp chạy ở AI Studio / domain khác)
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.get("/", (_req, res) => res.send("victorsharp-labs-proxy is running"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() })
);

// API
app.use("/api/flow", flowRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    method: req.method,
    path: req.path,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
