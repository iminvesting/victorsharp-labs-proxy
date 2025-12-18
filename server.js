/**
 * VictorSharp Labs Proxy - server.js
 * Exposes:
 *  - GET  /health
 *  - /api/flow/*  (handled by flowRoutes.js)
 */

import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import flowRoutes from "./flowRoutes.js";

const app = express();

const PORT = process.env.PORT || 10000;

// --- middleware ---
app.use(compression());

// CORS: allow all (safe for proxy). If you want to restrict, set CORS_ORIGIN env.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: false,
  })
);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use(
  morgan(":method :url :status :res[content-length] - :response-time ms")
);

// --- basic routes ---
app.get("/", (req, res) => {
  res.status(200).send("VictorSharp Labs Proxy is running.");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// --- api routes ---
app.use("/api/flow", flowRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// error handler
app.use((err, req, res, next) => {
  console.error("[SERVER_ERROR]", err);
  res.status(500).json({
    ok: false,
    error: err?.message || "Internal Server Error",
  });
});

app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
