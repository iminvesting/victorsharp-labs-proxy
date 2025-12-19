import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// ✅ CORS an toàn cho Render + browser (không bật credentials với origin '*')
app.use(cors({ origin: "*" }));

app.use(express.json({ limit: "50mb" }));

app.get("/", (_req, res) => res.send("victorsharp-labs-proxy is running"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "victorsharp-labs-proxy", ts: Date.now() })
);

app.use("/api/flow", flowRoutes);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`[FLOW] listening on ${PORT}`));
