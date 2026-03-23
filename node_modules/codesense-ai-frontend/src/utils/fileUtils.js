import {
  EXTENSION_LANGUAGE_MAP,
  LANGUAGE_ICONS,
  SPECIAL_FILENAMES,
} from "../constants/languages";

export const WORKSPACE_IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "out",
  "tmp",
  "temp",
]);

export const MAX_IMPORT_FILE_SIZE = 1024 * 1024 * 2;

export function capitalize(value = "") {
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function detectLanguage(filename = "") {
  const safeName = String(filename || "").trim();
  if (!safeName) return "text";
  const lower = safeName.toLowerCase();
  if (SPECIAL_FILENAMES[lower]) return SPECIAL_FILENAMES[lower];
  const lastDot = lower.lastIndexOf(".");
  if (lastDot === -1 || lastDot === lower.length - 1) return "text";
  const ext = lower.slice(lastDot + 1);
  return EXTENSION_LANGUAGE_MAP[ext] || "text";
}

export function getLanguageIcon(lang = "") {
  return LANGUAGE_ICONS[lang] || LANGUAGE_ICONS.default;
}

export function countLines(content = "") {
  if (!content) return 0;
  return content.split("\n").length;
}

export function normalizeFilePath(value = "") {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function getRelativeFileName(file) {
  return normalizeFilePath(file?.relativePath || file?.webkitRelativePath || file?.name || "untitled.txt") || "untitled.txt";
}

export function getBaseName(value = "") {
  const normalized = normalizeFilePath(value);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized || "untitled.txt";
}

export function getParentPath(value = "") {
  const normalized = normalizeFilePath(value);
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function sortTreeNodes(nodes) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  nodes.forEach((node) => {
    if (node.type === "folder") {
      sortTreeNodes(node.children);
    }
  });

  return nodes;
}

function ensureFolderNode(root, lookup, folderPath) {
  const normalized = normalizeFilePath(folderPath);
  const parts = normalized.split("/").filter(Boolean);
  let bucket = root;
  let currentPath = "";

  parts.forEach((part) => {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const lookupKey = `folder:${currentPath}`;

    if (!lookup.has(lookupKey)) {
      const node = { type: "folder", name: part, path: currentPath, children: [] };
      lookup.set(lookupKey, node);
      bucket.push(node);
    }

    bucket = lookup.get(lookupKey).children;
  });
}

export function buildFileTree(files = [], folderPaths = []) {
  const root = [];
  const lookup = new Map();

  folderPaths.forEach((folderPath) => {
    ensureFolderNode(root, lookup, folderPath);
  });

  files.forEach((file) => {
    const normalized = normalizeFilePath(file.name);
    const parts = normalized.split("/").filter(Boolean);
    let bucket = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      const lookupKey = `${isFile ? "file" : "folder"}:${currentPath}`;

      if (!lookup.has(lookupKey)) {
        const node = isFile
          ? { type: "file", name: part, path: currentPath, file }
          : { type: "folder", name: part, path: currentPath, children: [] };
        lookup.set(lookupKey, node);
        bucket.push(node);
      }

      const node = lookup.get(lookupKey);
      if (!isFile) {
        bucket = node.children;
      }
    });
  });

  return sortTreeNodes(root);
}

export function getIgnoredWorkspaceFolderPath(value = "") {
  const parts = normalizeFilePath(value).split("/").filter(Boolean);
  const ignoredIndex = parts.findIndex(
    (part, index) => index < parts.length - 1 && WORKSPACE_IGNORED_DIRECTORY_NAMES.has(part.toLowerCase())
  );

  if (ignoredIndex === -1) return "";
  return parts.slice(0, ignoredIndex + 1).join("/");
}

export function buildWorkspaceSnapshot(files = []) {
  return files.reduce((acc, file) => {
    acc[file.name] = String(file.content || "");
    return acc;
  }, {});
}

export function computeWorkspaceGitChanges(files = [], snapshot = {}) {
  const currentSnapshot = buildWorkspaceSnapshot(files);
  const currentNames = new Set(Object.keys(currentSnapshot));
  const baselineNames = new Set(Object.keys(snapshot || {}));
  const unstaged = [];
  const untracked = [];

  files.forEach((file) => {
    if (!baselineNames.has(file.name)) {
      untracked.push({
        type: "added",
        file: file.name,
        lines: countLines(file.content),
      });
      return;
    }

    if (snapshot[file.name] !== String(file.content || "")) {
      unstaged.push({
        type: "modified",
        file: file.name,
        lines: countLines(file.content),
      });
    }
  });

  Object.keys(snapshot || {}).forEach((fileName) => {
    if (!currentNames.has(fileName)) {
      unstaged.push({
        type: "deleted",
        file: fileName,
        lines: countLines(snapshot[fileName]),
      });
    }
  });

  return { staged: [], unstaged, untracked };
}

export function summarizeGitChanges(changes) {
  const allChanges = [
    ...(changes?.staged || []),
    ...(changes?.unstaged || []),
    ...(changes?.untracked || []),
  ];

  if (!allChanges.length) return "workspace snapshot";

  const counts = allChanges.reduce(
    (acc, change) => {
      acc[change.type] = (acc[change.type] || 0) + 1;
      return acc;
    },
    { added: 0, modified: 0, deleted: 0 }
  );

  return [
    counts.added ? `${counts.added} added` : "",
    counts.modified ? `${counts.modified} modified` : "",
    counts.deleted ? `${counts.deleted} deleted` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function getWorkspaceNameFromSelection(incoming) {
  const list = Array.from(incoming || []);
  const relative = getRelativeFileName(list[0]);
  const parts = normalizeFilePath(relative).split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "";
}

export function ensureUniqueName(name, takenNames) {
  const trimmed = String(name || "").trim() || "untitled.txt";
  if (!takenNames.includes(trimmed)) return trimmed;
  const dotIndex = trimmed.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const base = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
  const ext = hasExtension ? trimmed.slice(dotIndex) : "";
  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (takenNames.includes(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

export function readFileAsText(file) {
  if (typeof file?.content === "string") {
    return Promise.resolve(String(file.content));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

export async function readDirectoryHandle(directoryHandle) {
  if (!directoryHandle || directoryHandle.kind !== "directory") {
    throw new Error("A readable directory handle is required.");
  }

  const files = [];
  const ignoredFolders = [];
  const skippedFiles = [];

  const walk = async (handle, parentPath) => {
    for await (const entry of handle.values()) {
      const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

      if (entry.kind === "directory") {
        if (WORKSPACE_IGNORED_DIRECTORY_NAMES.has(String(entry.name || "").toLowerCase())) {
          ignoredFolders.push(entryPath);
          continue;
        }
        await walk(entry, entryPath);
        continue;
      }

      const file = await entry.getFile();
      if (file.size > MAX_IMPORT_FILE_SIZE) {
        skippedFiles.push(entryPath);
        continue;
      }
      files.push({
        name: file.name,
        relativePath: entryPath,
        content: await file.text(),
        handle: entry,
        size: file.size,
      });
    }
  };

  await walk(directoryHandle, directoryHandle.name);

  return {
    name: directoryHandle.name,
    files,
    ignoredFolders,
    skippedFiles,
  };
}

export function downloadTextFile(filename, content) {
  const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
