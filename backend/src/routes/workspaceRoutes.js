const express = require("express");
const {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
} = require("../controllers/workspaceController");

const router = express.Router();

router.get("/", listWorkspaces);
router.get("/:id", getWorkspace);
router.post("/", createWorkspace);
router.put("/:id", updateWorkspace);

module.exports = router;
