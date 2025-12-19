import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// Render sets PORT
const PORT = process.env.PORT || 10000;

// CORS
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// IMPORTANT: base64 image payload can be big
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health
app.get("/", (_req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", ts: Date.now() });
});

// API
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
    error: err?.message || "Internal Server Error",
  });
});

app.listen(PORT, () => {
  console.log(`[FLOW] listening on ${PORT}`);
  console.log(`=> Your service is live 🎉`);
});
