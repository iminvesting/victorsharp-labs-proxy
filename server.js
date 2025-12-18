// server.js
import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "50mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "victorsharp-flow-proxy" });
});

// Flow API
app.use("/api/flow", flowRoutes);

// Fallback
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "API Endpoint Not Found" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[FLOW] Server running on port ${PORT}`);
});
