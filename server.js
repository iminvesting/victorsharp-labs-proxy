// server.js (ESM)
// VictorSharp Flow Proxy Backend (Render)
// - GET  /health
// - Mount /api/flow -> flowRoutes
// - 404 JSON: { ok:false, error:"API Endpoint Not Found", method, path }

import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

app.set("trust proxy", true);

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

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use((req, _res, next) => {
  console.log(`[INCOMING] ${req.method} ${req.path}`);
  next();
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// mount routes
app.use("/api/flow", flowRoutes);

// 404 fallback (MATCH format your frontend is showing)
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    method: req.method,
    path: req.path,
  });
});

// global error
app.use((err, _req, res, _next) => {
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
