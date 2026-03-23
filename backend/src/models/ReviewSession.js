const { mongoose } = require("../config/db");

const reviewSessionSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, default: null },
    fileName: { type: String, required: true },
    mode: { type: String, required: true },
    score: { type: Number, default: null },
    grade: { type: String, default: null },
    summary: { type: String, default: "" },
    issues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    improvements: { type: [String], default: [] },
    raw: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ReviewSession || mongoose.model("ReviewSession", reviewSessionSchema);
