// server.js (ESM) - Render + Node 18+
// MUST use import (repo has "type":"module")

import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// --- CORS ---
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// --- Body parsers ---
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Health ---
app.get(["/", "/health"], (req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// --- Flow API ---
app.use("/api/flow", flowRoutes);

// --- 404 fallback (JSON) ---
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    method: req.method,
    path: req.originalUrl,
  });
});

// --- Start ---
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`[FLOW-BACKEND] listening on port ${port}`);
});
