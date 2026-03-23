const workspaceStore = require("../services/workspaceStore");

async function listWorkspaces(req, res) {
  try {
    const workspaces = await workspaceStore.listWorkspaces();
    res.json({ workspaces });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to list workspaces." });
  }
}

async function getWorkspace(req, res) {
  try {
    const workspace = await workspaceStore.getWorkspace(req.params.id);

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    return res.json({ workspace });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load workspace." });
  }
}

async function createWorkspace(req, res) {
  try {
    const workspace = await workspaceStore.createWorkspace(req.body || {});
    return res.status(201).json({ workspace });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to create workspace." });
  }
}

async function updateWorkspace(req, res) {
  try {
    const workspace = await workspaceStore.updateWorkspace(req.params.id, req.body || {});

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    return res.json({ workspace });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update workspace." });
  }
}

module.exports = {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
};
