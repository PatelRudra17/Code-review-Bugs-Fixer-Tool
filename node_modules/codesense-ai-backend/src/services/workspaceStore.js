const crypto = require("crypto");
const { isMongoReady } = require("../config/db");
const Workspace = require("../models/Workspace");

const memoryStore = new Map();

function makeId() {
  return crypto.randomUUID();
}

function normalizePayload(payload = {}) {
  return {
    name: payload.name || "Workspace",
    files: Array.isArray(payload.files) ? payload.files : [],
    results: payload.results && typeof payload.results === "object" ? payload.results : {},
    settings: payload.settings && typeof payload.settings === "object" ? payload.settings : {},
    branchName: payload.branchName || "main",
  };
}

async function listWorkspaces() {
  if (isMongoReady()) {
    return Workspace.find().sort({ updatedAt: -1 }).lean();
  }

  return Array.from(memoryStore.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

async function getWorkspace(id) {
  if (isMongoReady()) {
    return Workspace.findById(id).lean();
  }

  return memoryStore.get(id) || null;
}

async function createWorkspace(payload) {
  const normalized = normalizePayload(payload);

  if (isMongoReady()) {
    const workspace = await Workspace.create(normalized);
    return workspace.toObject();
  }

  const now = new Date().toISOString();
  const workspace = { _id: makeId(), ...normalized, createdAt: now, updatedAt: now };
  memoryStore.set(workspace._id, workspace);
  return workspace;
}

async function updateWorkspace(id, payload) {
  const normalized = normalizePayload(payload);

  if (isMongoReady()) {
    const workspace = await Workspace.findByIdAndUpdate(id, normalized, {
      new: true,
      runValidators: true,
    }).lean();
    return workspace;
  }

  const existing = memoryStore.get(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...normalized,
    updatedAt: new Date().toISOString(),
  };
  memoryStore.set(id, updated);
  return updated;
}

module.exports = {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
};
