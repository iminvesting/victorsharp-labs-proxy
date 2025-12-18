// server.js (ESM) — VictorSharp Labs Proxy
import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// ---- middlewares
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- basic routes
app.get("/", (_req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// ---- Flow API routes
app.use("/api/flow", flowRoutes);

// ---- 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    method: req.method,
    path: req.originalUrl,
  });
});

// ---- crash safety logs
process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED_REJECTION]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
});

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
