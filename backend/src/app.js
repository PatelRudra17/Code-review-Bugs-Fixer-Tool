const express = require("express");
const cors = require("cors");
const aiRoutes = require("./routes/aiRoutes");
const workspaceRoutes = require("./routes/workspaceRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const { isMongoReady } = require("./config/db");

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",") : true,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "codesense-ai-backend",
    storage: isMongoReady() ? "mongo" : "memory",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/ai", aiRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/reviews", reviewRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: error.message || "Internal server error." });
});

module.exports = app;
