const { mongoose } = require("../config/db");

const fileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    content: { type: String, default: "" },
    lang: { type: String, default: "text" },
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, default: "Workspace" },
    files: { type: [fileSchema], default: [] },
    results: { type: mongoose.Schema.Types.Mixed, default: {} },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    branchName: { type: String, default: "main" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Workspace || mongoose.model("Workspace", workspaceSchema);
