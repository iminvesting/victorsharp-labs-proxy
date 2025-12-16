import express from "express";
import cors from "cors";
import flowRoutes from "./flowRoutes.js";

const app = express();

// If your frontend and backend are same-origin, you can remove cors().
// If different domains, configure cors({ origin: [...] })
app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "flow-backend" }));

// All Flow API routes
app.use("/api/flow", flowRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[FLOW-BACKEND] listening on port ${PORT}`);
  console.log(`[FLOW-BACKEND] FLOW_BASE_URL=${process.env.FLOW_BASE_URL || "https://labs.google"}`);
  console.log(`[FLOW-BACKEND] FLOW_VEO_GENERATE_URL=${process.env.FLOW_VEO_GENERATE_URL || "(default /fx/api/video/generate)"}`);
  console.log(`[FLOW-BACKEND] FLOW_VEO_STATUS_URL=${process.env.FLOW_VEO_STATUS_URL || "(default /fx/api/video/status/{id})"}`);
});
