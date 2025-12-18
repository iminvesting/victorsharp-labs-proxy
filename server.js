// server.js (ESM) - Render friendly
import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
  })
);

// preflight
app.options("*", cors());

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("victorsharp-labs-proxy is running");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

app.use("/api/flow", flowRoutes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API Endpoint Not Found",
    method: req.method,
    path: req.originalUrl,
  });
});

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
