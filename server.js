import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import flowRoutes from "./flowRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS for AI Studio iframe
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Origin", "Accept"],
  })
);
app.options("*", cors());

// Logger
app.use((req, _res, next) => {
  console.log(`[INCOMING] ${req.method} ${req.originalUrl}`);
  next();
});

// Body
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() });
});

// API routes
app.use("/api/flow", flowRoutes);

// (Optional) serve dist if you bundle frontend into proxy
app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback: NEVER swallow /api/flow
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/flow")) {
    return res.status(404).json({ ok: false, error: "API Endpoint Not Found" });
  }

  const indexPath = path.join(__dirname, "dist", "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) res.status(200).send("Proxy backend is running. Frontend not deployed.");
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
