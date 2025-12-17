// server.js (ESM) - Render Proxy Backend
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import flowRoutes from "./flowRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/**
 * 1) CORS (Crucial for AI Studio iframe)
 * - Allow all origins (public proxy)
 * - Allow Authorization header
 * - Handle preflight OPTIONS
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Origin", "Accept"],
    exposedHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);
app.options("*", cors());

/**
 * 2) Request Logger
 */
app.use((req, _res, next) => {
  console.log(`[INCOMING] ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * 3) Body parser (large payload)
 * NOTE: Flow payload can be large.
 */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/**
 * 4) Health Check
 * - used by WebApp health check ping
 */
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "victorsharp-labs-proxy",
    ts: Date.now(),
  });
});

/**
 * 5) Flow API Routes
 */
app.use("/api/flow", flowRoutes);

/**
 * 6) Serve Static Assets (optional)
 * If you deploy proxy only (no dist), it still works (dist won't exist).
 */
app.use(express.static(path.join(__dirname, "dist")));

/**
 * 7) SPA Fallback
 * - Never swallow /api routes
 * - If dist missing, return a simple message
 */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ ok: false, error: "API Endpoint Not Found" });
  }

  const indexPath = path.join(__dirname, "dist", "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      // Dist not deployed -> still fine for proxy usage
      res.status(200).send("Proxy backend is running. Frontend not deployed.");
    }
  });
});

/**
 * 8) Start server
 */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
});
