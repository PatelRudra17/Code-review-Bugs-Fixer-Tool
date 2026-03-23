import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_SERVER_HEALTH,
  EDITOR_FONT,
  THEMES,
  UI_FONT,
} from "./config/ui";
import {
  MODE_CONFIG,
  SEV_COLOR,
  VALID_SEVERITIES,
  VIEW_CONFIG,
} from "./constants/review";
import {
  buildFileTree,
  buildWorkspaceSnapshot,
  capitalize,
  computeWorkspaceGitChanges,
  countLines,
  detectLanguage,
  downloadTextFile,
  ensureUniqueName,
  getBaseName,
  getLanguageIcon,
  getIgnoredWorkspaceFolderPath,
  getParentPath,
  getRelativeFileName,
  getWorkspaceNameFromSelection,
  MAX_IMPORT_FILE_SIZE,
  normalizeFilePath,
  readFileAsText,
  readDirectoryHandle,
  summarizeGitChanges,
} from "./utils/fileUtils";
import {
  computeDiff,
  copyText,
  extractJsonString,
  formatTimestamp,
  getSeverityCounts,
  gradeColor,
  metricColor,
  normalizeResult,
  scoreColor,
  trimHistory,
} from "./utils/reviewUtils";
import { readStoredJson } from "./utils/storage";
import { exportHTML } from "./services/reportService";
import {
  buildChatSystem,
  buildReviewPrompt,
  buildReviewSystem,
} from "./services/promptService";
import { runLocalChat, runLocalReview } from "./services/localAiService";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const SECONDARY_AGENT_OPTIONS = [
  {
    value: "agent",
    label: "Agent",
    instruction: "Act like an implementation partner and help build the requested change.",
  },
  {
    value: "review",
    label: "Review",
    instruction: "Focus on findings, risks, and the most important review feedback first.",
  },
  {
    value: "fix",
    label: "Fix",
    instruction: "Focus on repairing the bug or code path the user is targeting.",
  },
  {
    value: "test",
    label: "Tests",
    instruction: "Focus on test coverage, edge cases, and concrete test ideas.",
  },
];

const SECONDARY_DEPTH_OPTIONS = [
  { value: "auto", label: "Auto", instruction: "Balance speed with depth." },
  { value: "quick", label: "Quick", instruction: "Keep the answer short and actionable." },
  { value: "deep", label: "Deep", instruction: "Reason more carefully and go deeper before answering." },
];

const SECONDARY_APPROVAL_OPTIONS = [
  {
    value: "default",
    label: "Default Approvals",
    instruction: "Use a balanced recommendation style with practical tradeoffs.",
  },
  {
    value: "careful",
    label: "Careful Approvals",
    instruction: "Prefer lower-risk changes and call out safer options first.",
  },
  {
    value: "direct",
    label: "Direct Approvals",
    instruction: "Give direct implementation guidance and concrete next steps.",
  },
];

const FREE_CHAT_MODELS = [
  {
    value: "auto-free",
    label: "Auto",
    detail: "Best free route",
    badge: "Free",
  },
  {
    value: "codesense-lite",
    label: "CodeSense Lite",
    detail: "Fast local help",
    badge: "Free",
  },
  {
    value: "codesense-flash",
    label: "CodeSense Flash",
    detail: "Balanced free reasoning",
    badge: "Free",
  },
  {
    value: "codesense-reasoner",
    label: "CodeSense Reasoner",
    detail: "Deeper free analysis",
    badge: "Free",
  },
  {
    value: "other-free",
    label: "Other Free Models",
    detail: "More free models soon",
    badge: "Soon",
  },
];

const PREMIUM_CHAT_MODELS = [
  {
    value: "auto-premium",
    label: "Auto",
    detail: "Best premium route",
    badge: "Premium",
  },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    detail: "Fast premium reasoning",
    badge: "1x",
  },
  {
    value: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    detail: "Deep premium analysis",
    badge: "Premium",
  },
  {
    value: "gpt-5-4",
    label: "GPT-5.4",
    detail: "Advanced premium planning",
    badge: "Premium",
  },
  {
    value: "other-premium",
    label: "Other Models",
    detail: "Bring your own provider",
    badge: "More",
  },
];

const getChatModelOption = (catalog, value) =>
  catalog.find((item) => item.value === value) || catalog[0];

const DEFAULT_EXTENSION_CATALOG = [
  {
    id: "codesense.ai-review",
    name: "CodeSense AI Review",
    publisher: "CodeSense",
    description: "Built-in review, bug fixing, diff inspection, and workspace chat for the current IDE.",
    version: "1.0.0",
    rating: 5.0,
    installsLabel: "Built In",
    category: "AI",
    tags: ["ai", "review", "chat", "bugfix"],
    recommendedFor: ["javascript", "typescript", "jsx", "tsx", "python"],
    installed: true,
    enabled: true,
    builtIn: true,
    featured: true,
  },
  {
    id: "codesense.vscode-theme-pack",
    name: "VS Code Theme Pack",
    publisher: "CodeSense",
    description: "Theme presets and contrast tuning inspired by the desktop VS Code workbench.",
    version: "1.2.0",
    rating: 4.8,
    installsLabel: "Built In",
    category: "Themes",
    tags: ["theme", "ui"],
    recommendedFor: ["javascript", "typescript", "json", "css"],
    installed: true,
    enabled: true,
    builtIn: true,
    featured: true,
  },
  {
    id: "dbaeumer.vscode-eslint",
    name: "ESLint",
    publisher: "Microsoft",
    description: "Integrates ESLint diagnostics and quick fixes for JavaScript and TypeScript projects.",
    version: "3.0.11",
    rating: 4.7,
    installsLabel: "29M",
    category: "Linters",
    tags: ["eslint", "lint", "javascript", "typescript"],
    recommendedFor: ["javascript", "typescript", "jsx", "tsx"],
    installed: true,
    enabled: true,
    builtIn: false,
    featured: true,
  },
  {
    id: "esbenp.prettier-vscode",
    name: "Prettier",
    publisher: "Prettier",
    description: "Format JavaScript, TypeScript, JSON, HTML, CSS, and markdown with one click.",
    version: "11.0.0",
    rating: 4.8,
    installsLabel: "36M",
    category: "Formatting",
    tags: ["formatter", "prettier", "javascript", "typescript", "json"],
    recommendedFor: ["javascript", "typescript", "jsx", "tsx", "json", "css", "html"],
    installed: false,
    enabled: false,
    builtIn: false,
    featured: true,
  },
  {
    id: "eamodio.gitlens",
    name: "GitLens",
    publisher: "GitKraken",
    description: "See recent changes, authorship, and branch insights directly inside the editor.",
    version: "2026.3.0",
    rating: 4.9,
    installsLabel: "18M",
    category: "Source Control",
    tags: ["git", "history", "blame"],
    recommendedFor: ["javascript", "typescript", "python"],
    installed: false,
    enabled: false,
    builtIn: false,
    featured: true,
  },
  {
    id: "bradlc.vscode-tailwindcss",
    name: "Tailwind CSS IntelliSense",
    publisher: "Tailwind Labs",
    description: "Autocomplete, linting, and hover previews for utility-first styling workflows.",
    version: "0.14.3",
    rating: 4.8,
    installsLabel: "11M",
    category: "Styling",
    tags: ["tailwind", "css", "html", "jsx", "tsx"],
    recommendedFor: ["html", "css", "jsx", "tsx"],
    installed: false,
    enabled: false,
    builtIn: false,
    featured: true,
  },
  {
    id: "mongodb.mongodb-vscode",
    name: "MongoDB for VS Code",
    publisher: "MongoDB",
    description: "Browse collections, explore documents, and keep MERN projects close to the database layer.",
    version: "1.11.0",
    rating: 4.6,
    installsLabel: "3.4M",
    category: "Databases",
    tags: ["mongodb", "database", "mern"],
    recommendedFor: ["json", "javascript", "typescript"],
    installed: false,
    enabled: false,
    builtIn: false,
    featured: false,
  },
  {
    id: "rangav.vscode-thunder-client",
    name: "Thunder Client",
    publisher: "Thunder Client",
    description: "Run API requests quickly while building Express and MERN backends.",
    version: "2.28.2",
    rating: 4.7,
    installsLabel: "7.9M",
    category: "API",
    tags: ["api", "rest", "backend", "express"],
    recommendedFor: ["javascript", "typescript", "json"],
    installed: false,
    enabled: false,
    builtIn: false,
    featured: false,
  },
];

const mergeExtensionsWithCatalog = (savedExtensions) => {
  const savedMap = new Map(
    Array.isArray(savedExtensions)
      ? savedExtensions
          .filter((extension) => extension && typeof extension.id === "string")
          .map((extension) => [extension.id, extension])
      : []
  );

  return DEFAULT_EXTENSION_CATALOG.map((extension) => ({
    ...extension,
    ...(savedMap.get(extension.id) || {}),
    tags: Array.isArray(savedMap.get(extension.id)?.tags)
      ? savedMap.get(extension.id).tags
      : extension.tags,
    recommendedFor: Array.isArray(savedMap.get(extension.id)?.recommendedFor)
      ? savedMap.get(extension.id).recommendedFor
      : extension.recommendedFor,
  }));
};

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const sanitizeEditorSettings = (settings) => {
  const next = {
    ...DEFAULT_EDITOR_SETTINGS,
    ...(settings && typeof settings === "object" ? settings : {}),
  };

  next.fontSize = clampNumber(next.fontSize, 10, 24, DEFAULT_EDITOR_SETTINGS.fontSize);
  next.tabSize = [2, 4, 8].includes(Number(next.tabSize))
    ? Number(next.tabSize)
    : DEFAULT_EDITOR_SETTINGS.tabSize;
  next.wordWrap = ["on", "off", "wordWrapColumn"].includes(next.wordWrap)
    ? next.wordWrap
    : DEFAULT_EDITOR_SETTINGS.wordWrap;
  next.minimap = false;
  next.lineNumbers = next.lineNumbers !== false;
  next.folding = next.folding !== false;
  next.autoIndent = next.autoIndent !== false;
  next.bracketPairColorization = next.bracketPairColorization !== false;

  return next;
};

export default function CodeSenseAI() {
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState("");
  const [workspaceLabel, setWorkspaceLabel] = useState("Workspace");
  const [mode, setMode] = useState("full");
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [view, setView] = useState("editor");
  const [rightTab, setRightTab] = useState("issues");
  const [filterSev, setFilterSev] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("codesense-theme") || "dark";
  });
  const [copiedAll, setCopiedAll] = useState(false);
  const [primaryChatMsgs, setPrimaryChatMsgs] = useState([]);
  const [primaryChatInput, setPrimaryChatInput] = useState("");
  const [primaryChatLoading, setPrimaryChatLoading] = useState(false);
  const [primaryChatModel, setPrimaryChatModel] = useState("auto-free");
  const [primaryModelMenuOpen, setPrimaryModelMenuOpen] = useState(false);
  const [primaryAgentMode, setPrimaryAgentMode] = useState("agent");
  const [primaryDepthMode, setPrimaryDepthMode] = useState("auto");
  const [primaryContextScope, setPrimaryContextScope] = useState("focused");
  const [primaryApprovalMode, setPrimaryApprovalMode] = useState("default");
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [secondaryChatModel, setSecondaryChatModel] = useState("auto-premium");
  const [secondaryModelMenuOpen, setSecondaryModelMenuOpen] = useState(false);
  const [secondaryAgentMode, setSecondaryAgentMode] = useState("agent");
  const [secondaryDepthMode, setSecondaryDepthMode] = useState("auto");
  const [secondaryContextScope, setSecondaryContextScope] = useState("focused");
  const [secondaryApprovalMode, setSecondaryApprovalMode] = useState("default");
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [activity, setActivity] = useState("explorer");
  const [assistantTab, setAssistantTab] = useState("review");
  const [bottomTab, setBottomTab] = useState("problems");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [openTabs, setOpenTabs] = useState([]);
  const [outputLogs, setOutputLogs] = useState(() => [
    { id: 1, kind: "info", text: "CodeSense IDE booted.", timestamp: Date.now() },
  ]);
  const [terminalLines, setTerminalLines] = useState(() => [
    { id: 1, text: "CodeSense terminal ready. Type help for commands." },
  ]);
  const [terminalInput, setTerminalInput] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [showBottomPanel, setShowBottomPanel] = useState(true);
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [expandedIssues, setExpandedIssues] = useState({});
  const [copiedFixes, setCopiedFixes] = useState({});
  const [notice, setNotice] = useState(null);
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("codesense-anthropic-api-key") || "";
  });
  const [showKey, setShowKey] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth
  );
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [extensionQuery, setExtensionQuery] = useState("");
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editorSettings, setEditorSettings] = useState(() => {
    return sanitizeEditorSettings(
      readStoredJson("codesense-editor-settings", DEFAULT_EDITOR_SETTINGS)
    );
  });
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [extensions, setExtensions] = useState(() =>
    mergeExtensionsWithCatalog(readStoredJson("codesense-extensions", DEFAULT_EXTENSION_CATALOG))
  );
  const [autoSave, setAutoSave] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("codesense-autosave") === "true";
  });
  const [zoom, setZoom] = useState(() => {
    if (typeof window === "undefined") return 100;
    const saved = Number.parseInt(localStorage.getItem("codesense-zoom") || "100", 10);
    return clampNumber(saved, 50, 200, 100);
  });
  const [terminalHistory, setTerminalHistory] = useState([]);
  const [terminalCursor, setTerminalCursor] = useState(0);
  const [splitOrientation, setSplitOrientation] = useState("vertical");
  const [openEditors, setOpenEditors] = useState([]);
  const [pinTabs, setPinTabs] = useState([]);
  const [recentFiles, setRecentFiles] = useState(() => {
    const saved = readStoredJson("codesense-recent-files", []);
    return Array.isArray(saved) ? saved : [];
  });
  const [bookmarks, setBookmarks] = useState(() => {
    const saved = readStoredJson("codesense-bookmarks", {});
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  });
  const [debugMode, setDebugMode] = useState(false);
  const [breakpoints, setBreakpoints] = useState({});
  const [debugVariables, setDebugVariables] = useState([]);
  const [debugCallStack, setDebugCallStack] = useState([]);
  const [outputPanelContent, setOutputPanelContent] = useState([]);
  const [problemsPanelFilter, setProblemsPanelFilter] = useState("all");
  const [gitChanges, setGitChanges] = useState({ staged: [], unstaged: [], untracked: [] });
  const [gitBranch, setGitBranch] = useState("main");
  const [gitCommits, setGitCommits] = useState([]);
  const [serverHealth, setServerHealth] = useState(DEFAULT_SERVER_HEALTH);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [savedFileContents, setSavedFileContents] = useState({});
  const [workspaceFolderPaths, setWorkspaceFolderPaths] = useState([]);
  const [workspaceId, setWorkspaceId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("codesense-workspace-id") || "";
  });
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window === "undefined") return true;
    return !localStorage.getItem("codesense-welcomed");
  });

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const primaryChatScrollRef = useRef(null);
  const chatScrollRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const editorTextareaRef = useRef(null);
  const editorContainerRef = useRef(null);
  const gutterScrollRef = useRef(null);
  const commandInputRef = useRef(null);
  const monacoEditorRef = useRef(null);
  const monacoModelRef = useRef(null);
  const gitSnapshotRef = useRef({});
  const fileHandleMapRef = useRef({});
  const resultsRef = useRef(results);
  const workspaceHydratedRef = useRef(false);
  const workspaceSyncErrorRef = useRef("");
  const [monacoReady, setMonacoReady] = useState(() => typeof window !== 'undefined' && window.monacoReady);

  const palette = THEMES[theme] || THEMES.dark;
  const activeFileData = files.find((file) => file.name === activeFile) || null;
  const activeResult = activeFile ? results[activeFile] : null;
  const isFileDirty = (fileName) => {
    const file = files.find((item) => item.name === fileName);
    if (!file) return false;
    if (!Object.prototype.hasOwnProperty.call(savedFileContents, fileName)) return false;
    return savedFileContents[fileName] !== String(file.content || "");
  };
  const activeFileDirty = activeFileData ? isFileDirty(activeFileData.name) : false;
  const hasApiKey = Boolean(apiKey.trim());
  const supportsLocalAi = true;
  const canUseAiFeatures = hasApiKey || supportsLocalAi;
  const aiBannerBackground = hasApiKey ? "rgba(34,197,94,0.12)" : "rgba(96,165,250,0.12)";
  const aiBannerBorder = hasApiKey ? "rgba(34,197,94,0.28)" : "rgba(96,165,250,0.28)";
  const aiBannerColor = hasApiKey ? "#86efac" : "#93c5fd";
  const aiInlineBackground = hasApiKey ? "rgba(78,201,176,0.08)" : "rgba(96,165,250,0.12)";
  const aiInlineBorder = hasApiKey ? "rgba(78,201,176,0.28)" : "rgba(96,165,250,0.28)";
  const aiInlineColor = hasApiKey ? "#4ec9b0" : "#93c5fd";
  const aiStatusChip = hasApiKey ? "READY" : "LOCAL";
  const aiStatusLabel = hasApiKey ? "Anthropic Ready" : "Local AI Ready";
  const aiAvailabilityText = hasApiKey
    ? "Cloud analysis and chat are enabled."
    : "Offline review and chat are enabled. Add an Anthropic key for deeper cloud analysis.";
  const fileTree = buildFileTree(files, workspaceFolderPaths);
  const workspaceLanguages = Array.from(
    new Set(
      files
        .map((file) => String(file.lang || detectLanguage(file.name) || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const manualLang = detectLanguage(nameInput);
  const isThreeColumn = windowWidth >= 1220;
  const isTwoColumn = windowWidth >= 900;
  const isCompact = windowWidth < 720;
  const centerView = view;
  const diffRows =
    activeFileData && activeResult?.fixedCode
      ? computeDiff(activeFileData.content, activeResult.fixedCode)
      : [];

  const diffStats = diffRows.reduce(
    (acc, row) => {
      if (row.type === "add") acc.add += 1;
      if (row.type === "remove") acc.remove += 1;
      if (row.type === "same") acc.same += 1;
      return acc;
    },
    { add: 0, remove: 0, same: 0 }
  );

  const filteredIssues = (activeResult?.issues || []).filter((issue) => {
    const matchesSeverity = filterSev === "all" ? true : issue.severity === filterSev;
    const target = `${issue.title} ${issue.description} ${issue.category} ${issue.severity}`.toLowerCase();
    const matchesSearch = searchQ.trim()
      ? target.includes(searchQ.trim().toLowerCase())
      : true;
    return matchesSeverity && matchesSearch;
  });

  const workspaceMatches = workspaceSearch.trim()
    ? files
        .flatMap((file) =>
          String(file.content || "")
            .split("\n")
            .map((line, index) => ({
              fileName: file.name,
              lineNumber: index + 1,
              line,
            }))
            .filter((item) => item.line.toLowerCase().includes(workspaceSearch.trim().toLowerCase()))
        )
        .slice(0, 120)
    : [];

  const analyzedFiles = files.filter((file) => {
    const result = results[file.name];
    return result && !result.error && typeof result.score === "number";
  });
  const avgQuality = analyzedFiles.length
    ? Math.round(
        analyzedFiles.reduce((sum, file) => sum + (results[file.name]?.score || 0), 0) /
          analyzedFiles.length
      )
    : 0;
  const totalIssues = analyzedFiles.reduce(
    (sum, file) => sum + (results[file.name]?.issues?.length || 0),
    0
  );
  const criticalIssues = analyzedFiles.reduce(
    (sum, file) =>
      sum +
      (results[file.name]?.issues?.filter((issue) => issue.severity === "critical").length || 0),
    0
  );
  const serverHealthLabel =
    serverHealth.state === "connected"
      ? "Connected"
      : serverHealth.state === "offline"
        ? "Offline"
        : "Checking";
  const serverHealthColor =
    serverHealth.state === "connected"
      ? "#22c55e"
      : serverHealth.state === "offline"
        ? "#ef4444"
        : "#f59e0b";

  const setTransientNotice = useCallback((type, text) => {
    setNotice({ type, text });
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3200);
  }, []);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const appendOutput = useCallback((kind, text) => {
    setOutputLogs((prev) => [
      ...prev.slice(-119),
      {
        id: Date.now() + Math.random(),
        kind,
        text,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const openExtensionsPanel = useCallback(() => {
    setActivity("extensions");
    setView("editor");
  }, []);

  const installExtension = useCallback(
    (extensionId) => {
      const extension = extensions.find((item) => item.id === extensionId);
      if (!extension) return;
      if (extension.installed && extension.enabled) {
        setTransientNotice("info", `${extension.name} is already installed and enabled.`);
        return;
      }

      setExtensions((prev) =>
        prev.map((item) =>
          item.id === extensionId
            ? {
                ...item,
                installed: true,
                enabled: true,
              }
            : item
        )
      );
      appendOutput("extensions", `Installed extension ${extension.name}.`);
      setTransientNotice("success", `${extension.name} installed.`);
    },
    [appendOutput, extensions, setTransientNotice]
  );

  const toggleExtensionEnabled = useCallback(
    (extensionId) => {
      const extension = extensions.find((item) => item.id === extensionId);
      if (!extension || !extension.installed) return;

      const nextEnabled = !extension.enabled;
      setExtensions((prev) =>
        prev.map((item) =>
          item.id === extensionId
            ? {
                ...item,
                enabled: nextEnabled,
              }
            : item
        )
      );
      appendOutput(
        "extensions",
        `${nextEnabled ? "Enabled" : "Disabled"} extension ${extension.name}.`
      );
      setTransientNotice(
        nextEnabled ? "success" : "info",
        `${extension.name} ${nextEnabled ? "enabled" : "disabled"}.`
      );
    },
    [appendOutput, extensions, setTransientNotice]
  );

  const uninstallExtension = useCallback(
    (extensionId) => {
      const extension = extensions.find((item) => item.id === extensionId);
      if (!extension || extension.builtIn) return;

      setExtensions((prev) =>
        prev.map((item) =>
          item.id === extensionId
            ? {
                ...item,
                installed: false,
                enabled: false,
              }
            : item
        )
      );
      appendOutput("extensions", `Uninstalled extension ${extension.name}.`);
      setTransientNotice("info", `${extension.name} uninstalled.`);
    },
    [appendOutput, extensions, setTransientNotice]
  );

  const resetExtensionsCatalog = useCallback(() => {
    setExtensions(mergeExtensionsWithCatalog(DEFAULT_EXTENSION_CATALOG));
    appendOutput("extensions", "Reset extension catalog to default recommendations.");
    setTransientNotice("success", "Extensions reset to default catalog.");
  }, [appendOutput, setTransientNotice]);

  const apiRequest = useCallback(async (path, options = {}) => {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
        ...options,
      });

      const data = await response.json().catch(() => ({}));
      setServerHealth((prev) =>
        prev.state === "connected" && prev.message === "Backend connected."
          ? prev
          : { state: "connected", message: "Backend connected." }
      );

      if (!response.ok) {
        const requestError = new Error(
          data?.message ||
            data?.error?.message ||
            `Request failed with status ${response.status}.`
        );
        requestError.status = response.status;
        requestError.data = data;
        throw requestError;
      }

      return data;
    } catch (error) {
      if (typeof error?.status === "number") {
        throw error;
      }

      const networkError = new Error(
        "Cannot reach the backend server. Start the Express server and confirm the API port matches the client proxy."
      );
      networkError.cause = error;
      setServerHealth({ state: "offline", message: networkError.message });
      throw networkError;
    }
  }, []);

  const checkServerHealth = useCallback(async () => {
    try {
      const data = await apiRequest("/api/health");
      const storageLabel =
        data?.storage === "mongo"
          ? "MongoDB"
          : data?.storage === "memory"
            ? "memory storage"
            : "backend";
      setServerHealth({
        state: "connected",
        message: data?.service
          ? `${data.service} online (${storageLabel})`
          : "Backend connected.",
      });
    } catch (error) {
      setServerHealth({ state: "offline", message: error.message });
    }
  }, [apiRequest]);

  const refreshGitState = useCallback(() => {
    const nextChanges = computeWorkspaceGitChanges(files, gitSnapshotRef.current);
    setGitChanges(nextChanges);
    return nextChanges;
  }, [files]);

  const commitWorkspaceSnapshot = useCallback(() => {
    const nextChanges = computeWorkspaceGitChanges(files, gitSnapshotRef.current);
    const totalChanges =
      nextChanges.staged.length + nextChanges.unstaged.length + nextChanges.untracked.length;

    if (!totalChanges) {
      appendOutput("git", "No workspace changes detected.");
      setTransientNotice("info", "No workspace changes to commit.");
      return;
    }

    const summary = summarizeGitChanges(nextChanges);
    const commitEntry = {
      id: Date.now(),
      message: `workspace: ${summary}`,
      timestamp: Date.now(),
      changeCount: totalChanges,
    };

    gitSnapshotRef.current = buildWorkspaceSnapshot(files);
    setGitChanges({ staged: [], unstaged: [], untracked: [] });
    setGitCommits((prev) => [commitEntry, ...prev].slice(0, 12));
    appendOutput("git", `Committed workspace snapshot: ${summary}.`);
    setTransientNotice("success", `Committed ${totalChanges} change${totalChanges === 1 ? "" : "s"}.`);
  }, [appendOutput, files, setTransientNotice]);

  const syncWorkspaceToServer = useCallback(
    async (nextFiles = files, nextResults = results, nextWorkspaceLabel = workspaceLabel) => {
      if (!workspaceHydratedRef.current) return null;
      if (!nextFiles.length && !Object.keys(nextResults || {}).length) return null;

      const payload = {
        name: nextWorkspaceLabel || "Workspace",
        files: nextFiles,
        results: nextResults,
        branchName: gitBranch,
        settings: {
          theme,
          editorSettings,
          autoSave,
          zoom,
          bookmarks,
          extensions,
          recentFiles,
        },
      };

      try {
        let data;

        if (workspaceId) {
          try {
            data = await apiRequest(`/api/workspaces/${workspaceId}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
          } catch (error) {
            if (error?.status !== 404) {
              throw error;
            }
            appendOutput("server", "Saved workspace reference expired. Creating a new workspace on the server.");
            data = await apiRequest("/api/workspaces", {
              method: "POST",
              body: JSON.stringify(payload),
            });
          }
        } else {
          data = await apiRequest("/api/workspaces", {
            method: "POST",
            body: JSON.stringify(payload),
          });
        }

        if (data?.workspace?._id && data.workspace._id !== workspaceId) {
          setWorkspaceId(data.workspace._id);
        }
        workspaceSyncErrorRef.current = "";
        return data?.workspace || null;
      } catch (error) {
        if (workspaceSyncErrorRef.current !== error.message) {
          appendOutput("server", `Workspace sync skipped: ${error.message}`);
          workspaceSyncErrorRef.current = error.message;
        }
        return null;
      }
    },
    [
      apiRequest,
      autoSave,
      bookmarks,
      editorSettings,
      extensions,
      files,
      gitBranch,
      recentFiles,
      results,
      theme,
      workspaceId,
      workspaceLabel,
      zoom,
      appendOutput,
    ]
  );

  const fetchReviewHistory = useCallback(
    async (targetWorkspaceId = workspaceId) => {
      if (!targetWorkspaceId) {
        setReviewHistory([]);
        return [];
      }

      try {
        const data = await apiRequest(
          `/api/reviews?workspaceId=${encodeURIComponent(targetWorkspaceId)}`
        );
        const nextReviews = Array.isArray(data?.reviews) ? data.reviews : [];
        setReviewHistory(nextReviews);
        return nextReviews;
      } catch (error) {
        appendOutput("server", `Review history unavailable: ${error.message}`);
        return [];
      }
    },
    [apiRequest, appendOutput, workspaceId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    localStorage.setItem("codesense-theme", theme);
    return undefined;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    localStorage.setItem("codesense-anthropic-api-key", apiKey);
    return undefined;
  }, [apiKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (workspaceId) {
      localStorage.setItem("codesense-workspace-id", workspaceId);
    } else {
      localStorage.removeItem("codesense-workspace-id");
    }
    return undefined;
  }, [workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const markMonacoReady = () => setMonacoReady(true);
    window.addEventListener("codesense-monaco-ready", markMonacoReady);

    if (window.monacoReady) {
      setMonacoReady(true);
    }

    return () => window.removeEventListener("codesense-monaco-ready", markMonacoReady);
  }, []);

  useEffect(() => {
    checkServerHealth();
    const timer = window.setInterval(checkServerHealth, 30000);
    return () => window.clearInterval(timer);
  }, [checkServerHealth]);

  useEffect(() => {
    const node = folderInputRef.current;
    if (!node) return;
    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let ignore = false;

    const hydrateWorkspace = async () => {
      if (!workspaceId) {
        workspaceHydratedRef.current = true;
        return;
      }

      try {
        const data = await apiRequest(`/api/workspaces/${workspaceId}`);
        if (ignore || !data?.workspace) return;

        const remoteWorkspace = data.workspace;
        const remoteFiles = Array.isArray(remoteWorkspace.files)
          ? remoteWorkspace.files.map((remoteFile) => ({
              name: String(remoteFile?.name || "untitled.txt"),
              content: String(remoteFile?.content || ""),
              lang: remoteFile?.lang || detectLanguage(remoteFile?.name || "untitled.txt"),
            }))
          : [];
        const remoteResults =
          remoteWorkspace.results && typeof remoteWorkspace.results === "object"
            ? remoteWorkspace.results
            : {};
        const remoteSettings =
          remoteWorkspace.settings && typeof remoteWorkspace.settings === "object"
            ? remoteWorkspace.settings
            : {};
        const remoteSavedContents = remoteFiles.reduce((acc, file) => {
          acc[file.name] = String(file.content || "");
          return acc;
        }, {});
        setWorkspaceLabel(remoteWorkspace.name || "Workspace");
        setFiles(remoteFiles);
        setSavedFileContents(remoteSavedContents);
        setWorkspaceFolderPaths([]);
        fileHandleMapRef.current = {};
        setResults(remoteResults);
        resultsRef.current = remoteResults;
        setGitBranch(remoteWorkspace.branchName || "main");
        if (remoteSettings.theme === "dark" || remoteSettings.theme === "light") {
          setTheme(remoteSettings.theme);
        }
        if (remoteSettings.editorSettings && typeof remoteSettings.editorSettings === "object") {
          setEditorSettings({
            ...DEFAULT_EDITOR_SETTINGS,
            ...remoteSettings.editorSettings,
          });
        }
        if (typeof remoteSettings.autoSave === "boolean") {
          setAutoSave(remoteSettings.autoSave);
        }
        if (remoteSettings.bookmarks && typeof remoteSettings.bookmarks === "object") {
          setBookmarks(remoteSettings.bookmarks);
        }
        if (Array.isArray(remoteSettings.extensions)) {
          setExtensions(mergeExtensionsWithCatalog(remoteSettings.extensions));
        }
        if (Array.isArray(remoteSettings.recentFiles)) {
          setRecentFiles(remoteSettings.recentFiles);
        }
        const remoteZoom = Number.parseInt(remoteSettings.zoom, 10);
        if (Number.isFinite(remoteZoom)) {
          setZoom(Math.min(200, Math.max(50, remoteZoom)));
        }
        if (remoteFiles.length) {
          setActiveFile((prev) => prev || remoteFiles[0].name);
        }
        appendOutput("server", `Loaded workspace "${remoteWorkspace.name || "Workspace"}" from the server.`);
      } catch (error) {
        if (!ignore) {
          if (error?.status === 404) {
            setWorkspaceId("");
            setReviewHistory([]);
            appendOutput(
              "server",
              "Saved workspace was not found on the server. A new workspace will be created on the next save."
            );
          } else {
            appendOutput("server", `Workspace load skipped: ${error.message}`);
          }
        }
      } finally {
        if (!ignore) {
          workspaceHydratedRef.current = true;
        }
      }
    };

    hydrateWorkspace();

    return () => {
      ignore = true;
    };
  }, [apiRequest, appendOutput, workspaceId]);

  useEffect(() => {
    setGitChanges(computeWorkspaceGitChanges(files, gitSnapshotRef.current));
  }, [files]);

  useEffect(() => {
    if (!workspaceHydratedRef.current) return undefined;

    const timer = setTimeout(() => {
      syncWorkspaceToServer();
    }, 900);

    return () => clearTimeout(timer);
  }, [files, results, workspaceLabel, theme, editorSettings, autoSave, zoom, bookmarks, recentFiles, syncWorkspaceToServer]);

  useEffect(() => {
    if (!workspaceId) {
      setReviewHistory([]);
      return;
    }

    fetchReviewHistory(workspaceId);
  }, [fetchReviewHistory, workspaceId]);

  useEffect(() => {
    if (!activeFile) return;
    setOpenTabs((prev) => (prev.includes(activeFile) ? prev : [...prev, activeFile]));
  }, [activeFile]);

  useEffect(() => {
    setOpenTabs((prev) => prev.filter((name) => files.some((file) => file.name === name)));
  }, [files]);

  useEffect(() => {
    if (!files.length && !workspaceFolderPaths.length) {
      setWorkspaceLabel("Workspace");
      setCollapsedFolders({});
      setSavedFileContents({});
      fileHandleMapRef.current = {};
    }
  }, [files.length, workspaceFolderPaths.length]);

  useEffect(() => {
    if (primaryChatScrollRef.current) {
      primaryChatScrollRef.current.scrollTop = primaryChatScrollRef.current.scrollHeight;
    }
  }, [primaryChatMsgs, primaryChatLoading]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMsgs, chatLoading]);

  useEffect(() => {
    if (!commandPaletteOpen) return undefined;
    const timer = setTimeout(() => commandInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [commandPaletteOpen]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      if (monacoEditorRef.current) {
        monacoEditorRef.current.dispose();
      }
      if (monacoModelRef.current) {
        monacoModelRef.current.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const normalizedSettings = sanitizeEditorSettings(editorSettings);
    if (JSON.stringify(normalizedSettings) !== JSON.stringify(editorSettings)) {
      setEditorSettings(normalizedSettings);
      return;
    }

    localStorage.setItem("codesense-editor-settings", JSON.stringify(normalizedSettings));
  }, [editorSettings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("codesense-autosave", autoSave);
  }, [autoSave]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const normalizedZoom = clampNumber(zoom, 50, 200, 100);
    if (normalizedZoom !== zoom) {
      setZoom(normalizedZoom);
      return;
    }

    localStorage.setItem("codesense-zoom", normalizedZoom);
    document.body.style.zoom = `${normalizedZoom}%`;
  }, [zoom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("codesense-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("codesense-extensions", JSON.stringify(extensions));
  }, [extensions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("codesense-recent-files", JSON.stringify(recentFiles.slice(0, 10)));
  }, [recentFiles]);

  useEffect(() => {
    if (!monacoReady || !editorContainerRef.current || !activeFileData) return;

    if (monacoEditorRef.current) {
      monacoEditorRef.current.dispose();
      monacoEditorRef.current = null;
    }
    if (monacoModelRef.current) {
      monacoModelRef.current.dispose();
      monacoModelRef.current = null;
    }

    const language = activeFileData.lang || detectLanguage(activeFileData.name);
    const model = monaco.editor.createModel(activeFileData.content, language);
    const container = editorContainerRef.current;

    const editor = monaco.editor.create(container, {
      model,
      theme: theme === "dark" ? "vs-dark" : "vs",
      fontSize: clampNumber(editorSettings.fontSize, 10, 24, DEFAULT_EDITOR_SETTINGS.fontSize),
      tabSize: [2, 4, 8].includes(Number(editorSettings.tabSize))
        ? Number(editorSettings.tabSize)
        : DEFAULT_EDITOR_SETTINGS.tabSize,
      wordWrap: ["on", "off", "wordWrapColumn"].includes(editorSettings.wordWrap)
        ? editorSettings.wordWrap
        : DEFAULT_EDITOR_SETTINGS.wordWrap,
      minimap: {
        enabled: false,
      },
      lineNumbers: editorSettings.lineNumbers !== false ? "on" : "off",
      folding: editorSettings.folding !== false,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: editorSettings.bracketPairColorization !== false },
      padding: { top: 10, bottom: 10 },
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontLigatures: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      contextmenu: true,
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      formatOnPaste: true,
      formatOnType: true,
    });

    const layoutEditor = () => {
      if (!editorContainerRef.current) return;
      const width = editorContainerRef.current.clientWidth;
      const height = editorContainerRef.current.clientHeight;
      if (width > 0 && height > 0) {
        editor.layout({ width, height });
      }
    };

    let resizeObserver = null;
    let frameOne = 0;
    let frameTwo = 0;
    let timer = 0;

    frameOne = window.requestAnimationFrame(() => {
      layoutEditor();
      frameTwo = window.requestAnimationFrame(() => {
        layoutEditor();
        editor.focus();
      });
    });

    timer = window.setTimeout(layoutEditor, 120);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => layoutEditor());
      resizeObserver.observe(container);
    }

    editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      updateFileContent(activeFileData.name, value);
    });

    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, column: e.position.column });
    });

    monacoEditorRef.current = editor;
    monacoModelRef.current = model;

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(timer);
      resizeObserver?.disconnect();
      editor.dispose();
      model.dispose();
      if (monacoEditorRef.current === editor) {
        monacoEditorRef.current = null;
      }
      if (monacoModelRef.current === model) {
        monacoModelRef.current = null;
      }
    };
  }, [activeFile, monacoReady, theme, editorSettings, showRightSidebar, windowWidth]);

  useEffect(() => {
    if (!monacoEditorRef.current || !editorContainerRef.current) return;

    const editor = monacoEditorRef.current;
    const relayout = () => {
      const width = editorContainerRef.current?.clientWidth || 0;
      const height = editorContainerRef.current?.clientHeight || 0;
      if (width > 0 && height > 0) {
        editor.layout({ width, height });
      }
    };

    const frame = window.requestAnimationFrame(() => {
      relayout();
      window.requestAnimationFrame(relayout);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeFile, showBottomPanel, showFindReplace, showRightSidebar, view, windowWidth, zoom]);

  const performAnthropicRequest = useCallback(
    async (payload) => {
      return apiRequest("/api/ai/messages", {
        method: "POST",
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          payload,
        }),
      });
    },
    [apiKey, apiRequest]
  );

  const revealFilePath = useCallback((filePath) => {
    const parentPath = getParentPath(filePath);
    if (!parentPath) return;

    setCollapsedFolders((prev) => {
      const next = { ...prev };
      let currentPath = "";
      parentPath
        .split("/")
        .filter(Boolean)
        .forEach((segment) => {
          currentPath = currentPath ? `${currentPath}/${segment}` : segment;
          next[currentPath] = false;
        });
      return next;
    });
  }, []);

  const dismissWelcomeOverlay = useCallback(() => {
    setShowWelcome(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("codesense-welcomed", "true");
    }
  }, []);

  const openFileInEditor = useCallback(
    (fileName) => {
      if (!fileName) return;
      dismissWelcomeOverlay();
      revealFilePath(fileName);
      setActiveFile(fileName);
      setView("editor");
    },
    [dismissWelcomeOverlay, revealFilePath]
  );

  const toggleFolder = useCallback((folderPath) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  }, []);

  const handleIncomingFiles = useCallback(
    async (incoming, options = {}) => {
      const list = Array.from(incoming || []);
      const replaceWorkspace = Boolean(options.replaceWorkspace);

      if (!list.length && !(options.ignoredFolders || []).length) return;

      const UNSUPPORTED_EXTENSIONS = [
        "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "svg",
        "mp3", "mp4", "wav", "ogg", "webm", "avi", "mov",
        "zip", "rar", "7z", "tar", "gz",
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "exe", "dll", "so", "dylib", "bin",
        "raw", "psd", "ai",
      ];

      const workspaceName = getWorkspaceNameFromSelection(list);
      const existingNames = replaceWorkspace ? [] : files.map((file) => file.name);
      const created = [];
      const errors = [];
      const savedEntries = {};
      const handleEntries = {};
      const ignoredFolderPaths = new Set(options.ignoredFolders || []);
      const skippedLargeFiles = [...(options.skippedFiles || [])];
      let unsupportedCount = 0;

      for (const file of list) {
        const relativeName = getRelativeFileName(file);
        const ignoredFolderPath = getIgnoredWorkspaceFolderPath(relativeName);
        if (ignoredFolderPath) {
          ignoredFolderPaths.add(ignoredFolderPath);
          continue;
        }

        if (Number(file?.size || 0) > MAX_IMPORT_FILE_SIZE) {
          skippedLargeFiles.push(relativeName);
          continue;
        }

        const ext = String(file?.name || "").toLowerCase().split(".").pop() || "";
        if (UNSUPPORTED_EXTENSIONS.includes(ext)) {
          unsupportedCount += 1;
          continue;
        }

        try {
          const content = await readFileAsText(file);
          if (!content || content.length === 0) {
            errors.push(`${file.name}: Empty file`);
            continue;
          }

          const normalizedRelativeName =
            workspaceName && relativeName.startsWith(`${workspaceName}/`)
              ? relativeName.slice(workspaceName.length + 1)
              : relativeName;
          const uniqueName = ensureUniqueName(normalizedRelativeName || "untitled.txt", [
            ...existingNames,
            ...created.map((item) => item.name),
          ]);

          created.push({
            name: uniqueName,
            content,
            lang: detectLanguage(uniqueName),
          });
          savedEntries[uniqueName] = String(content || "");
          if (file?.handle) {
            handleEntries[uniqueName] = file.handle;
          }
        } catch (error) {
          errors.push(`${file.name}: ${error.message}`);
        }
      }

      const normalizedIgnoredFolderPaths = Array.from(ignoredFolderPaths)
        .map((folderPath) =>
          workspaceName && folderPath.startsWith(`${workspaceName}/`)
            ? folderPath.slice(workspaceName.length + 1)
            : folderPath
        )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      if (!created.length && !normalizedIgnoredFolderPaths.length) {
        setTransientNotice(
          "error",
          unsupportedCount || skippedLargeFiles.length
            ? "No importable code files were loaded from this folder."
            : "No supported text files found. Please add code files (.js, .ts, .py, etc.)"
        );
        return;
      }

      if (errors.length > 0) {
        appendOutput("error", `Failed to load: ${errors.slice(0, 2).join(", ")}${errors.length > 2 ? "..." : ""}`);
      }

      if (replaceWorkspace) {
        setFiles(created);
        setResults({});
        resultsRef.current = {};
        setLoading({});
        setExpandedIssues({});
        setCopiedFixes({});
        setOpenTabs(created[0] ? [created[0].name] : []);
        setActiveFile(created[0]?.name || "");
        setCollapsedFolders({});
        setSavedFileContents(savedEntries);
        setWorkspaceFolderPaths(normalizedIgnoredFolderPaths);
        fileHandleMapRef.current = handleEntries;
      } else {
        setFiles((prev) => [...prev, ...created]);
        setSavedFileContents((prev) => ({
          ...prev,
          ...savedEntries,
        }));
        setWorkspaceFolderPaths((prev) =>
          Array.from(new Set([...prev, ...normalizedIgnoredFolderPaths])).sort((a, b) => a.localeCompare(b))
        );
        fileHandleMapRef.current = {
          ...fileHandleMapRef.current,
          ...handleEntries,
        };
        setActiveFile((prev) => prev || created[0]?.name || "");
      }

      if (created[0]) {
        revealFilePath(created[0].name);
      }
      if (workspaceName) {
        setWorkspaceLabel(workspaceName);
      }
      dismissWelcomeOverlay();

      const detailParts = [];
      if (created.length) {
        detailParts.push(`${created.length} file${created.length === 1 ? "" : "s"} loaded`);
      }
      if (normalizedIgnoredFolderPaths.length) {
        detailParts.push(`${normalizedIgnoredFolderPaths.length} heavy folder${normalizedIgnoredFolderPaths.length === 1 ? "" : "s"} shown collapsed`);
      }
      if (skippedLargeFiles.length) {
        detailParts.push(`${skippedLargeFiles.length} large file${skippedLargeFiles.length === 1 ? "" : "s"} skipped`);
      }
      if (unsupportedCount) {
        detailParts.push(`${unsupportedCount} unsupported file${unsupportedCount === 1 ? "" : "s"} skipped`);
      }

      appendOutput(
        "workspace",
        `${replaceWorkspace ? "Opened" : "Updated"} ${workspaceName || "workspace"}${detailParts.length ? `: ${detailParts.join(", ")}.` : "."}`
      );

      if (created.length && view !== "dashboard" && view !== "chat") {
        setView("editor");
      }

      setTransientNotice(
        "success",
        `${replaceWorkspace ? "Opened" : "Added"} ${workspaceName || "workspace"}${detailParts.length ? ` with ${detailParts.join(", ")}` : "."}`
      );
    },
    [appendOutput, dismissWelcomeOverlay, files, revealFilePath, setTransientNotice, view]
  );

  const handleFileInputChange = useCallback(
    async (event) => {
      await handleIncomingFiles(event.target.files);
      event.target.value = "";
    },
    [handleIncomingFiles]
  );

  const handleFolderInputChange = useCallback(
    async (event) => {
      await handleIncomingFiles(event.target.files, { replaceWorkspace: true });
      event.target.value = "";
    },
    [handleIncomingFiles]
  );

  const launchFilePicker = useCallback(() => {
    const openFileSelection = async () => {
      setActivity("explorer");

      if (typeof window !== "undefined" && typeof window.showOpenFilePicker === "function") {
        try {
          const handles = await window.showOpenFilePicker({ multiple: true });
          const selectedFiles = await Promise.all(
            handles.map(async (handle) => {
              const file = await handle.getFile();
              return {
                name: file.name,
                content: await file.text(),
                handle,
              };
            })
          );
          await handleIncomingFiles(selectedFiles);
          return;
        } catch (error) {
          if (error?.name === "AbortError") {
            return;
          }

          appendOutput("error", `File picker fallback used: ${error.message}`);
        }
      }

      requestAnimationFrame(() => fileInputRef.current?.click());
    };

    void openFileSelection();
  }, [appendOutput, handleIncomingFiles]);

  const launchFolderPicker = useCallback(() => {
    const openFolderSelection = async () => {
      setActivity("explorer");

      if (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function") {
        try {
          const directoryHandle = await window.showDirectoryPicker();
          const directoryData = await readDirectoryHandle(directoryHandle);
          await handleIncomingFiles(directoryData.files, {
            replaceWorkspace: true,
            ignoredFolders: directoryData.ignoredFolders,
            skippedFiles: directoryData.skippedFiles,
          });
          return;
        } catch (error) {
          if (error?.name === "AbortError") {
            return;
          }

          appendOutput("error", `Folder picker fallback used: ${error.message}`);
        }
      }

      requestAnimationFrame(() => {
        const node = folderInputRef.current;
        if (!node) {
          setTransientNotice("error", "Folder picker is not available in this browser.");
          return;
        }

        node.setAttribute("webkitdirectory", "");
        node.setAttribute("directory", "");
        node.click();
      });
    };

    void openFolderSelection();
  }, [appendOutput, handleIncomingFiles, setTransientNotice]);

  const handleManualAdd = useCallback(() => {
    if (!codeInput.trim()) {
      setTransientNotice("error", "Paste some code before adding a manual file.");
      return;
    }

    const uniqueName = ensureUniqueName(
      nameInput || "pasted-code.txt",
      files.map((file) => file.name)
    );
    const newFile = {
      name: uniqueName,
      content: codeInput,
      lang: detectLanguage(uniqueName),
    };

    setFiles((prev) => [...prev, newFile]);
    setSavedFileContents((prev) => ({
      ...prev,
      [uniqueName]: "",
    }));
    setActiveFile(uniqueName);
    revealFilePath(uniqueName);
    dismissWelcomeOverlay();
    setNameInput("");
    setCodeInput("");
    appendOutput("workspace", `Added ${uniqueName} from the manual paste panel.`);
    if (view !== "dashboard" && view !== "chat") {
      setView("editor");
    }
    setTransientNotice("success", `${uniqueName} added from the paste panel.`);
  }, [appendOutput, codeInput, dismissWelcomeOverlay, files, nameInput, revealFilePath, setTransientNotice, view]);

  const removeFile = useCallback(
    (name) => {
      setFiles((prev) => prev.filter((file) => file.name !== name));
      setResults((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setLoading((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setSavedFileContents((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      delete fileHandleMapRef.current[name];
      setExpandedIssues((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (key.startsWith(`${name}::`)) delete next[key];
        });
        return next;
      });
      setCopiedFixes((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (key.startsWith(`${name}::`)) delete next[key];
        });
        return next;
      });
      setActiveFile((prev) => {
        if (prev !== name) return prev;
        const remaining = files.filter((file) => file.name !== name);
        return remaining[0]?.name || "";
      });
      appendOutput("workspace", `Removed ${name} from the workspace.`);
    },
    [appendOutput, files]
  );

  const analyzeFile = useCallback(
    async (file) => {
      if (!file) {
        setTransientNotice("error", "Select a file before running analysis.");
        return;
      }
      if (!canUseAiFeatures) {
        setTransientNotice("error", "AI analysis is currently unavailable.");
        return;
      }

      const unsupportedLangs = ['image', 'binary', 'unknown'];
      if (unsupportedLangs.includes(file.lang)) {
        setTransientNotice("error", `"${file.name}" is a binary/image file and cannot be analyzed. Please select a code file (.js, .ts, .py, etc.)`);
        return;
      }
      if (!file.content || file.content.length === 0) {
        setTransientNotice("error", "The file is empty and cannot be analyzed.");
        return;
      }
      const isBinaryContent = /[\x00-\x08\x0E-\x1F\xFF]{5,}/.test(file.content.slice(0, 1000));
      if (isBinaryContent) {
        setTransientNotice("error", `"${file.name}" appears to be a binary file and cannot be analyzed.`);
        return;
      }

      setActiveFile(file.name);
      setLoading((prev) => ({ ...prev, [file.name]: true }));

      try {
        let raw = "";

        if (hasApiKey) {
          const payload = {
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: buildReviewSystem(MODE_CONFIG[mode]?.label || "full"),
            messages: [
              {
                role: "user",
                content: buildReviewPrompt(file, mode),
              },
            ],
          };

          const data = await performAnthropicRequest(payload);
          raw = (data?.content || [])
            .map((item) => (item?.type === "text" ? item.text : ""))
            .join("")
            .trim();
        } else {
          raw = JSON.stringify(runLocalReview(file, mode));
        }

        const parsed = JSON.parse(extractJsonString(raw));
        const normalized = normalizeResult(parsed, file.content);
        const enrichedResult = {
          ...normalized,
          mode,
          timestamp: Date.now(),
          raw,
          error: null,
        };
        const nextResults = {
          ...resultsRef.current,
          [file.name]: {
            ...enrichedResult,
          },
        };
        setResults(nextResults);
        resultsRef.current = nextResults;

        let resolvedWorkspaceId = workspaceId || null;
        const savedWorkspace = await syncWorkspaceToServer(files, nextResults, workspaceLabel);
        if (savedWorkspace?._id) {
          resolvedWorkspaceId = savedWorkspace._id;
        }

        try {
          const reviewData = await apiRequest("/api/reviews", {
            method: "POST",
            body: JSON.stringify({
              workspaceId: resolvedWorkspaceId,
              fileName: file.name,
              mode,
              score: enrichedResult.score,
              grade: enrichedResult.grade,
              summary: enrichedResult.summary,
              issues: enrichedResult.issues,
              improvements: enrichedResult.improvements,
              raw,
            }),
          });

          if (reviewData?.review) {
            setReviewHistory((prev) =>
              [reviewData.review, ...prev.filter((item) => item._id !== reviewData.review._id)].slice(0, 20)
            );
          }
        } catch (reviewError) {
          appendOutput("server", `Review history sync skipped: ${reviewError.message}`);
        }

        setRightTab("issues");
        appendOutput(
          "analysis",
          `${file.name} analyzed in ${MODE_CONFIG[mode].label} mode${hasApiKey ? "." : " with local AI."}`
        );
        setTransientNotice(
          "success",
          `${file.name} analyzed in ${MODE_CONFIG[mode].label} mode${hasApiKey ? "." : " with local AI."}`
        );
      } catch (error) {
        const failedResult = {
          summary: "The analysis request failed before a valid JSON review could be produced.",
          score: null,
          grade: null,
          issues: [],
          fixedCode: file.content,
          improvements: [],
          metrics: {
            complexity: "medium",
            maintainability: "medium",
            testability: "medium",
            documentation: "medium",
          },
          mode,
          timestamp: Date.now(),
          raw: "",
          error: error.message,
        };
        const nextResults = {
          ...resultsRef.current,
          [file.name]: failedResult,
        };
        setResults(nextResults);
        resultsRef.current = nextResults;
        appendOutput("error", `Analysis failed for ${file.name}: ${error.message}`);
        setTransientNotice("error", error.message);
      } finally {
        setLoading((prev) => ({ ...prev, [file.name]: false }));
      }
    },
    [
      apiRequest,
      appendOutput,
      canUseAiFeatures,
      files,
      hasApiKey,
      mode,
      performAnthropicRequest,
      setTransientNotice,
      syncWorkspaceToServer,
      workspaceId,
      workspaceLabel,
    ]
  );

  const analyzeAll = useCallback(async () => {
    if (!files.length) {
      setTransientNotice("error", "Add files before using Analyze All.");
      return;
    }
    appendOutput("analysis", `Analyze All started for ${files.length} files.`);
    for (const file of files) {
      await analyzeFile(file);
    }
    appendOutput("analysis", "Analyze All finished.");
  }, [analyzeFile, appendOutput, files, setTransientNotice]);

  const handleExportReport = useCallback(() => {
    try {
      exportHTML(files, results);
      appendOutput("export", "Exported the HTML review report.");
      setTransientNotice("success", "HTML report exported.");
    } catch (error) {
      appendOutput("error", `Export failed: ${error.message}`);
      setTransientNotice("error", error.message);
    }
  }, [appendOutput, files, results, setTransientNotice]);

  const handleCopyFixedCode = useCallback(async () => {
    if (!activeResult?.fixedCode) {
      setTransientNotice("error", "There is no fixed code to copy yet.");
      return;
    }
    try {
      await copyText(activeResult.fixedCode);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    } catch (error) {
      setTransientNotice("error", "Copy failed in this browser context.");
    }
  }, [activeResult, setTransientNotice]);

  const handleCopyIssueFix = useCallback(
    async (fileName, issueId, fix) => {
      try {
        await copyText(fix);
        const key = `${fileName}::${issueId}`;
        setCopiedFixes((prev) => ({ ...prev, [key]: true }));
        setTimeout(
          () =>
            setCopiedFixes((prev) => ({
              ...prev,
              [key]: false,
            })),
          1800
        );
      } catch (error) {
        setTransientNotice("error", "Copy failed in this browser context.");
      }
    },
    [setTransientNotice]
  );

  const updateFileContent = useCallback((fileName, nextContent) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.name === fileName
          ? {
              ...file,
              content: nextContent,
            }
          : file
      )
    );

    setResults((prev) => {
      if (!prev[fileName]) return prev;
      return {
        ...prev,
        [fileName]: {
          ...prev[fileName],
          stale: true,
        },
      };
    });
  }, []);

  const syncCursorFromTextarea = useCallback((node) => {
    if (!node) return;
    const before = node.value.slice(0, node.selectionStart || 0);
    const lines = before.split("\n");
    setCursorPos({
      line: lines.length,
      column: (lines[lines.length - 1] || "").length + 1,
    });
  }, []);

  const handleEditorChange = useCallback(
    (event) => {
      if (!activeFileData) return;
      updateFileContent(activeFileData.name, event.target.value);
      syncCursorFromTextarea(event.target);
    },
    [activeFileData, syncCursorFromTextarea, updateFileContent]
  );

  const handleEditorScroll = useCallback((event) => {
    if (gutterScrollRef.current) {
      gutterScrollRef.current.scrollTop = event.target.scrollTop;
    }
  }, []);

  const handleEditorKeyDown = useCallback(
    (event) => {
      if (!activeFileData || event.key !== "Tab") return;
      event.preventDefault();
      const node = event.target;
      const start = node.selectionStart || 0;
      const end = node.selectionEnd || 0;
      const nextValue = `${node.value.slice(0, start)}  ${node.value.slice(end)}`;
      updateFileContent(activeFileData.name, nextValue);
      requestAnimationFrame(() => {
        const textarea = editorTextareaRef.current;
        if (!textarea) return;
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
        syncCursorFromTextarea(textarea);
      });
    },
    [activeFileData, syncCursorFromTextarea, updateFileContent]
  );

  const closeTab = useCallback(
    (fileName) => {
      setOpenTabs((prev) => {
        const next = prev.filter((name) => name !== fileName);
        if (activeFile === fileName) {
          setActiveFile(next[next.length - 1] || files.find((file) => file.name !== fileName)?.name || "");
        }
        return next;
      });
    },
    [activeFile, files]
  );

  const applyFixedCodeToEditor = useCallback(() => {
    if (!activeFileData || !activeResult?.fixedCode) {
      setTransientNotice("error", "Analyze the current file before applying a fix.");
      return;
    }

    updateFileContent(activeFileData.name, activeResult.fixedCode);
    setView("editor");
    setAssistantTab("review");
    appendOutput("fix", `Applied AI fixed code to ${activeFileData.name}.`);
    setTransientNotice("success", `Applied the AI fix to ${activeFileData.name}.`);
  }, [activeFileData, activeResult, appendOutput, setTransientNotice, updateFileContent]);

  const saveFileToDisk = useCallback(
    async (file, options = {}) => {
      if (!file) return false;

      const content = String(file.content || "");
      const handle = fileHandleMapRef.current[file.name];

      if (handle?.createWritable) {
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        setSavedFileContents((prev) => ({
          ...prev,
          [file.name]: content,
        }));
        appendOutput("workspace", `Saved ${file.name} to disk.`);
        if (!options.silent) {
          setTransientNotice("success", `${file.name} saved.`);
        }
        return true;
      }

      downloadTextFile(getBaseName(file.name), content);
      setSavedFileContents((prev) => ({
        ...prev,
        [file.name]: content,
      }));
      appendOutput("export", `Downloaded ${file.name} because direct file saving is not available for this source.`);
      if (!options.silent) {
        setTransientNotice("success", `${file.name} downloaded as a save fallback.`);
      }
      return false;
    },
    [appendOutput, setTransientNotice]
  );

  const saveActiveFile = useCallback(async () => {
    if (!activeFileData) {
      setTransientNotice("error", "Open a file before saving it.");
      return;
    }

    await saveFileToDisk(activeFileData);
  }, [activeFileData, saveFileToDisk, setTransientNotice]);

  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = files.filter((file) =>
      Object.prototype.hasOwnProperty.call(savedFileContents, file.name) &&
      savedFileContents[file.name] !== String(file.content || "")
    );

    if (!dirtyFiles.length) {
      setTransientNotice("info", "No unsaved files to save.");
      return;
    }

    for (const file of dirtyFiles) {
      await saveFileToDisk(file, { silent: true });
    }

    appendOutput("workspace", `Saved ${dirtyFiles.length} file${dirtyFiles.length === 1 ? "" : "s"}.`);
    setTransientNotice("success", `Saved ${dirtyFiles.length} file${dirtyFiles.length === 1 ? "" : "s"}.`);
  }, [appendOutput, files, saveFileToDisk, savedFileContents, setTransientNotice]);

  const downloadActiveFile = useCallback(() => {
    if (!activeFileData) {
      setTransientNotice("error", "Open a file before exporting it.");
      return;
    }
    downloadTextFile(getBaseName(activeFileData.name), activeFileData.content);
    appendOutput("export", `Downloaded ${activeFileData.name}.`);
    setTransientNotice("success", `${activeFileData.name} downloaded.`);
  }, [activeFileData, appendOutput, setTransientNotice]);

  useEffect(() => {
    if (!autoSave || !activeFileData || !activeFileDirty) return undefined;
    if (!fileHandleMapRef.current[activeFileData.name]?.createWritable) return undefined;

    const timer = window.setTimeout(() => {
      void saveFileToDisk(activeFileData, { silent: true });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [activeFileData, activeFileDirty, autoSave, saveFileToDisk]);

  const openSecondaryChat = useCallback(() => {
    setShowRightSidebar(true);
    setAssistantTab("secondary");
  }, []);

  const runTerminalCommand = useCallback(
    async (rawInput) => {
      const command = String(rawInput || "").trim();
      if (!command) return;

      const pushLine = (text) =>
        setTerminalLines((prev) => [...prev.slice(-79), { id: Date.now() + Math.random(), text }]);

      pushLine(`> ${command}`);

      if (command === "help") {
        pushLine("Commands: help, analyze, analyze-all, diff, editor, dashboard, chat, explorer, apply-fix, save, save-all, export, clear");
        return;
      }
      if (command === "clear") {
        setTerminalLines([{ id: Date.now(), text: "Terminal cleared." }]);
        return;
      }
      if (command === "analyze") {
        if (activeFileData) {
          await analyzeFile(activeFileData);
          pushLine(`Analyzed ${activeFileData.name}.`);
        } else {
          pushLine("No active file selected.");
        }
        return;
      }
      if (command === "analyze-all") {
        await analyzeAll();
        pushLine("Analyze All completed.");
        return;
      }
      if (command === "diff") {
        setView("diff");
        pushLine("Opened diff view.");
        return;
      }
      if (command === "editor") {
        setView("editor");
        pushLine("Returned to editor.");
        return;
      }
      if (command === "dashboard") {
        setView("dashboard");
        pushLine("Opened dashboard.");
        return;
      }
      if (command === "chat") {
        openSecondaryChat();
        pushLine("Focused AI chat.");
        return;
      }
      if (command === "explorer") {
        setActivity("explorer");
        pushLine("Focused explorer.");
        return;
      }
      if (command === "apply-fix") {
        applyFixedCodeToEditor();
        pushLine("Applied AI fix if available.");
        return;
      }
      if (command === "save") {
        await saveActiveFile();
        pushLine("Saved the active file.");
        return;
      }
      if (command === "save-all") {
        await saveAllFiles();
        pushLine("Saved all dirty files.");
        return;
      }
      if (command === "export") {
        handleExportReport();
        pushLine("Exported report if available.");
        return;
      }

      pushLine(`Unknown command: ${command}`);
    },
    [activeFileData, analyzeAll, analyzeFile, applyFixedCodeToEditor, handleExportReport, openSecondaryChat, saveActiveFile, saveAllFiles]
  );

  const sendConversationMessage = useCallback(
    async ({
      promptInput,
      inputValue,
      messages,
      setMessages,
      clearInput,
      setLoadingState,
      requestLabel,
    }) => {
      const promptConfig =
        promptInput && typeof promptInput === "object" && !Array.isArray(promptInput)
          ? promptInput
          : null;
      const displayContent = String(
        promptConfig ? promptConfig.displayContent ?? inputValue : promptInput ?? inputValue
      ).trim();
      const content = String(
        promptConfig
          ? promptConfig.modelPrompt ?? promptConfig.displayContent ?? inputValue
          : promptInput ?? inputValue
      ).trim();
      if (!content) return;
      if (!canUseAiFeatures) {
        setTransientNotice("error", "AI chat is currently unavailable.");
        return;
      }

      const visibleHistory = trimHistory([...messages, { role: "user", content: displayContent }]);
      const modelHistory = trimHistory([...messages, { role: "user", content }]);
      setMessages(visibleHistory);
      clearInput();
      setLoadingState(true);
      appendOutput(
        "chat",
        `Asked ${requestLabel}: ${displayContent.slice(0, 72)}${displayContent.length > 72 ? "..." : ""}`
      );

      try {
        let reply = "";

        if (hasApiKey) {
          const payload = {
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: buildChatSystem(activeFileData, activeResult),
            messages: modelHistory.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
          };

          const data = await performAnthropicRequest(payload);
          reply = (data?.content || [])
            .map((item) => (item?.type === "text" ? item.text : ""))
            .join("")
            .trim();
        } else {
          reply = runLocalChat({
            prompt: content,
            file: activeFileData,
            result: activeResult,
          });
        }

        const assistantMessage = {
          role: "assistant",
          content:
            reply ||
            (hasApiKey
              ? "I did not receive any content back from Claude."
              : "Local AI did not produce a response."),
        };
        setMessages((prev) => trimHistory([...prev, assistantMessage]));
        appendOutput(
          "chat",
          hasApiKey ? `${requestLabel} received a premium response.` : `${requestLabel} received a local response.`
        );
      } catch (error) {
        setMessages((prev) =>
          trimHistory([
            ...prev,
            {
              role: "assistant",
              content: hasApiKey
                ? `I hit an error while calling Anthropic: ${error.message}`
                : `I hit an error while running local AI: ${error.message}`,
            },
          ])
        );
        appendOutput("error", `${requestLabel} failed: ${error.message}`);
      } finally {
        setLoadingState(false);
      }
    },
    [
      activeFileData,
      activeResult,
      appendOutput,
      canUseAiFeatures,
      hasApiKey,
      performAnthropicRequest,
      setTransientNotice,
    ]
  );

  const sendPrimaryChatMessage = useCallback(
    (promptInput) => {
      const promptConfig =
        promptInput && typeof promptInput === "object" && !Array.isArray(promptInput)
          ? promptInput
          : null;
      const freeModel = getChatModelOption(FREE_CHAT_MODELS, primaryChatModel);
      const agentOption =
        SECONDARY_AGENT_OPTIONS.find((item) => item.value === primaryAgentMode) ||
        SECONDARY_AGENT_OPTIONS[0];
      const depthOption =
        SECONDARY_DEPTH_OPTIONS.find((item) => item.value === primaryDepthMode) ||
        SECONDARY_DEPTH_OPTIONS[0];
      const approvalOption =
        SECONDARY_APPROVAL_OPTIONS.find((item) => item.value === primaryApprovalMode) ||
        SECONDARY_APPROVAL_OPTIONS[0];
      const displayContent = String(
        promptConfig ? promptConfig.displayContent ?? primaryChatInput : promptInput ?? primaryChatInput
      ).trim();
      if (!displayContent) return;

      const target = activeFileData?.name || "the current workspace";
      const contextInstruction =
        primaryContextScope === "workspace"
          ? "Use broader workspace context when it helps, but keep the answer practical and lightweight."
          : `Keep the response anchored to the active file: ${target}.`;

      const modelPrompt =
        promptConfig?.modelPrompt ||
        [
          `Chat surface: Main Chat free workspace.`,
          `Selected free model: ${freeModel.label}. ${freeModel.detail}.`,
          `Mode: ${agentOption.label}. ${agentOption.instruction}`,
          `Depth: ${depthOption.label}. ${depthOption.instruction}`,
          `Approvals: ${approvalOption.label}. ${approvalOption.instruction}`,
          `Use a free-tier friendly answer style with practical, concise guidance.`,
          contextInstruction,
          `User request: ${displayContent}`,
        ].join("\n");

      sendConversationMessage({
        promptInput: {
          displayContent,
          modelPrompt,
        },
        inputValue: primaryChatInput,
        messages: primaryChatMsgs,
        setMessages: setPrimaryChatMsgs,
        clearInput: () => setPrimaryChatInput(""),
        setLoadingState: setPrimaryChatLoading,
        requestLabel: "Free Chat",
      });
    },
    [
      activeFileData,
      primaryAgentMode,
      primaryApprovalMode,
      primaryChatInput,
      primaryContextScope,
      primaryDepthMode,
      primaryChatModel,
      primaryChatMsgs,
      sendConversationMessage,
    ]
  );

  const insertPrimaryStarter = useCallback(() => {
    const target = activeFileData?.name || "this workspace";
    const templates = {
      agent: `Build or improve ${target}: `,
      review: `Review ${target} and summarize the top issues: `,
      fix: `Help fix the main bug in ${target}: `,
      test: `Create a test plan for ${target}: `,
    };
    const template = templates[primaryAgentMode] || templates.agent;
    setPrimaryChatInput((prev) => (prev.trim() ? `${prev}\n${template}` : template));
  }, [activeFileData, primaryAgentMode]);

  const togglePrimaryContextScope = useCallback(() => {
    setPrimaryContextScope((prev) => (prev === "focused" ? "workspace" : "focused"));
  }, []);

  const cyclePrimaryApprovalMode = useCallback(() => {
    const currentIndex = SECONDARY_APPROVAL_OPTIONS.findIndex(
      (item) => item.value === primaryApprovalMode
    );
    const nextItem =
      SECONDARY_APPROVAL_OPTIONS[
        currentIndex >= 0 ? (currentIndex + 1) % SECONDARY_APPROVAL_OPTIONS.length : 0
      ];
    setPrimaryApprovalMode(nextItem.value);
  }, [primaryApprovalMode]);

  const insertSecondaryStarter = useCallback(() => {
    const target = activeFileData?.name || "this workspace";
    const templates = {
      agent: `Build or improve ${target}: `,
      review: `Review ${target} and point out the highest-risk issues: `,
      fix: `Fix the main bug in ${target}: `,
      test: `Write a test plan for ${target}: `,
    };
    const template = templates[secondaryAgentMode] || templates.agent;
    setChatInput((prev) => (prev.trim() ? `${prev}\n${template}` : template));
  }, [activeFileData, secondaryAgentMode]);

  const toggleSecondaryContextScope = useCallback(() => {
    setSecondaryContextScope((prev) => (prev === "focused" ? "workspace" : "focused"));
  }, []);

  const cycleSecondaryApprovalMode = useCallback(() => {
    const currentIndex = SECONDARY_APPROVAL_OPTIONS.findIndex(
      (item) => item.value === secondaryApprovalMode
    );
    const nextItem =
      SECONDARY_APPROVAL_OPTIONS[
        currentIndex >= 0 ? (currentIndex + 1) % SECONDARY_APPROVAL_OPTIONS.length : 0
      ];
    setSecondaryApprovalMode(nextItem.value);
  }, [secondaryApprovalMode]);

  const sendSecondaryChatMessage = useCallback((promptInput) => {
    const promptConfig =
      promptInput && typeof promptInput === "object" && !Array.isArray(promptInput)
        ? promptInput
        : null;
    const userPrompt = String(
      promptConfig ? promptConfig.displayContent ?? chatInput : promptInput ?? chatInput
    ).trim();
    if (!userPrompt) return;

    const premiumModel = getChatModelOption(PREMIUM_CHAT_MODELS, secondaryChatModel);
    const agentOption =
      SECONDARY_AGENT_OPTIONS.find((item) => item.value === secondaryAgentMode) ||
      SECONDARY_AGENT_OPTIONS[0];
    const depthOption =
      SECONDARY_DEPTH_OPTIONS.find((item) => item.value === secondaryDepthMode) ||
      SECONDARY_DEPTH_OPTIONS[0];
    const approvalOption =
      SECONDARY_APPROVAL_OPTIONS.find((item) => item.value === secondaryApprovalMode) ||
      SECONDARY_APPROVAL_OPTIONS[0];
    const target = activeFileData?.name || "the current workspace";
    const contextInstruction =
      secondaryContextScope === "workspace"
        ? "Use broader workspace context when it helps, but keep the current task grounded."
        : `Keep the response anchored to the active file: ${target}.`;

    const modelPrompt =
      promptConfig?.modelPrompt ||
      [
        `Chat surface: Toggle Secondary premium chat.`,
        `Selected premium model: ${premiumModel.label}. ${premiumModel.detail}.`,
        `Mode: ${agentOption.label}. ${agentOption.instruction}`,
        `Depth: ${depthOption.label}. ${depthOption.instruction}`,
        `Approvals: ${approvalOption.label}. ${approvalOption.instruction}`,
        contextInstruction,
        `User request: ${userPrompt}`,
      ].join("\n");

    sendConversationMessage({
      promptInput: {
        displayContent: userPrompt,
        modelPrompt,
      },
      inputValue: chatInput,
      messages: chatMsgs,
      setMessages: setChatMsgs,
      clearInput: () => setChatInput(""),
      setLoadingState: setChatLoading,
      requestLabel: "Premium Secondary",
    });
  }, [
    activeFileData,
    chatInput,
    chatMsgs,
    secondaryAgentMode,
    secondaryApprovalMode,
    secondaryChatModel,
    secondaryContextScope,
    secondaryDepthMode,
    sendConversationMessage,
  ]);

  const openMainChat = useCallback(() => {
    setActivity("review");
    setAssistantTab("review");
    setShowRightSidebar(true);
    setView("chat");
  }, []);

  const toggleSecondaryChat = useCallback(() => {
    openSecondaryChat();
  }, [openSecondaryChat]);

  const handlePrimaryModelSelect = useCallback((value) => {
    setPrimaryChatModel(value);
    setPrimaryModelMenuOpen(false);
  }, []);

  const handleSecondaryModelSelect = useCallback(
    (value) => {
      setSecondaryChatModel(value);
      setSecondaryModelMenuOpen(false);
      if (!hasApiKey && value !== "auto-premium") {
        setTransientNotice(
          "info",
          "Premium model routing is selected. Add an API key to unlock cloud providers; until then Local AI will answer."
        );
      }
    },
    [hasApiKey, setTransientNotice]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      const isMeta = event.metaKey || event.ctrlKey;
      const isShift = event.shiftKey;
      
      if (isMeta && event.key === "Enter") {
        event.preventDefault();
        if (activeFileData) analyzeFile(activeFileData);
      } else if (isMeta && event.key === "d" && !isShift) {
        event.preventDefault();
        setView((prev) => (prev === "diff" ? "editor" : "diff"));
      } else if (isMeta && isShift && event.key === "d") {
        event.preventDefault();
        applyFixedCodeToEditor();
      } else if (isMeta && event.key === "k" && !isShift) {
        event.preventDefault();
        openMainChat();
      } else if (isMeta && event.key === "p" && !isShift) {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (isMeta && isShift && event.key === "p") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (isMeta && event.key === ",") {
        event.preventDefault();
        setShowSettings(true);
      } else if (isMeta && event.key === "f" && !isShift) {
        event.preventDefault();
        setShowFindReplace(true);
      } else if (isMeta && event.key === "h" && !isShift) {
        event.preventDefault();
        setShowFindReplace(true);
      } else if (event.key === "Escape") {
        if (showFindReplace) setShowFindReplace(false);
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        if (showSettings) setShowSettings(false);
        if (debugMode) setDebugMode(false);
      } else if (isMeta && event.key === "b") {
        event.preventDefault();
        setShowBottomPanel((prev) => !prev);
      } else if (isMeta && event.key === "\\") {
        event.preventDefault();
        setShowRightSidebar((prev) => !prev);
      } else if (isMeta && event.key === "s" && !isShift) {
        event.preventDefault();
        void saveActiveFile();
      } else if (isMeta && isShift && event.key === "s") {
        event.preventDefault();
        void saveAllFiles();
      } else if (isMeta && event.key === "g" && !isShift) {
        event.preventDefault();
        setGitPanelOpen(true);
      } else if (isMeta && event.key === "w" && !isShift) {
        event.preventDefault();
        if (activeFile) closeTab(activeFile);
      } else if (isMeta && event.key === "w" && isShift) {
        event.preventDefault();
        setOpenTabs([]);
        setActiveFile(null);
      } else if (isMeta && event.key === "Tab" && !isShift) {
        event.preventDefault();
        const tabs = openTabs;
        if (tabs.length > 1) {
          const idx = tabs.indexOf(activeFile);
          const nextIdx = (idx + 1) % tabs.length;
          setActiveFile(tabs[nextIdx]);
        }
      } else if (isShift && event.key === "Tab" && isMeta) {
        event.preventDefault();
        const tabs = openTabs;
        if (tabs.length > 1) {
          const idx = tabs.indexOf(activeFile);
          const prevIdx = (idx - 1 + tabs.length) % tabs.length;
          setActiveFile(tabs[prevIdx]);
        }
      } else if (isMeta && event.key === "=") {
        event.preventDefault();
        setZoom((z) => Math.min(z + 10, 200));
      } else if (isMeta && event.key === "-") {
        event.preventDefault();
        setZoom((z) => Math.max(z - 10, 50));
      } else if (isMeta && event.key === "0") {
        event.preventDefault();
        setZoom(100);
      } else if (isMeta && event.key === "o" && !isShift) {
        event.preventDefault();
        launchFilePicker();
      } else if (isMeta && isShift && event.key === "o") {
        event.preventDefault();
        launchFolderPicker();
      } else if (event.key === "F5") {
        event.preventDefault();
        setDebugMode((prev) => !prev);
        appendOutput("debug", debugMode ? "Debug session ended." : "Debug session started...");
      } else if (event.key === "F6") {
        event.preventDefault();
        appendOutput("debug", "Step over →");
      } else if (event.key === "F7") {
        event.preventDefault();
        appendOutput("debug", "Step into ↓");
      } else if (event.key === "F8") {
        event.preventDefault();
        appendOutput("debug", "Step out ↑");
      } else if (isMeta && event.key === "n" && isShift) {
        event.preventDefault();
        setShowWelcome(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFileData, analyzeFile, activeFile, appendOutput, closeTab, debugMode, launchFilePicker, launchFolderPicker, openMainChat, openTabs, saveActiveFile, saveAllFiles]);

  const panelStyle = {
    background: palette.panel,
    border: `1px solid ${palette.border}`,
    borderRadius: 0,
    boxShadow: palette.shadow,
  };

  const buttonBase = {
    border: `1px solid ${palette.border}`,
    borderRadius: 2,
    padding: "6px 10px",
    background: palette.panelAlt,
    color: palette.textSoft,
    fontFamily: UI_FONT,
    fontSize: 11,
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
    minHeight: 24,
  };

  const inputBase = {
    width: "100%",
    borderRadius: 2,
    border: `1px solid ${palette.inputBorder || palette.border}`,
    background: palette.inputBg || palette.codeBg,
    color: palette.text,
    padding: "6px 8px",
    fontFamily: UI_FONT,
    fontSize: 12,
    outlineColor: palette.accent,
  };

  const renderChatModelPicker = ({
    options,
    selectedValue,
    isOpen,
    onToggle,
    onSelect,
    variant = "free",
    width = 220,
  }) => {
    const selectedModel = getChatModelOption(options, selectedValue);
    const accentColor = variant === "premium" ? "#c084fc" : palette.accent;
    const badgeBackground =
      variant === "premium" ? "rgba(192,132,252,0.14)" : `${palette.accent}18`;

    return (
      <div style={{ position: "relative", minWidth: width }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            ...buttonBase,
            width: "100%",
            justifyContent: "space-between",
            background: palette.panel,
            color: palette.text,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ color: accentColor, fontWeight: 800, flexShrink: 0 }}>
              {variant === "premium" ? "AI" : "Free"}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedModel.label}
            </span>
          </span>
          <span style={{ color: palette.textMuted, fontSize: 10 }}>v</span>
        </button>
        {isOpen ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "calc(100% + 8px)",
              zIndex: 25,
              border: `1px solid ${palette.border}`,
              borderRadius: 10,
              background: palette.panel,
              boxShadow: "0 16px 28px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}
          >
            {options.map((option) => {
              const selected = option.value === selectedValue;
              return (
                <button
                  key={`${variant}-model-${option.value}`}
                  type="button"
                  onClick={() => onSelect(option.value)}
                  style={{
                    width: "100%",
                    border: "none",
                    background: selected ? palette.selection : "transparent",
                    color: palette.text,
                    padding: "10px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    borderBottom:
                      option.value === options[options.length - 1]?.value
                        ? "none"
                        : `1px solid ${palette.border}`,
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ color: accentColor, width: 12, flexShrink: 0 }}>
                        {selected ? "✓" : ""}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {option.label}
                      </span>
                    </span>
                    <span style={{ color: palette.textSoft, fontSize: 11, paddingLeft: 20 }}>
                      {option.detail}
                    </span>
                  </span>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 999,
                      border: `1px solid ${accentColor}45`,
                      background: badgeBackground,
                      color: accentColor,
                      fontSize: 10,
                      flexShrink: 0,
                    }}
                  >
                    {option.badge}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderTopBar = () => (
    <div
      style={{
        ...panelStyle,
        position: "sticky",
        top: 14,
        zIndex: 20,
        padding: isCompact ? 16 : 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 20 }}>
            <span>AI</span>
            <span>CodeSense AI</span>
          </div>
          <div style={{ color: palette.textSoft, fontSize: 12 }}>
            Code Reviewer & Bug Fixer
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 999,
              background: aiBannerBackground,
              border: `1px solid ${aiBannerBorder}`,
              fontSize: 12,
              color: aiBannerColor,
            }}
          >
            <span>{aiStatusChip}</span>
            <span>{aiStatusLabel}</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Anthropic API key"
              style={{
                ...inputBase,
                width: isCompact ? "100%" : 220,
                padding: "10px 12px",
              }}
            />
            <button type="button" onClick={() => setShowKey((prev) => !prev)} style={buttonBase}>
              {showKey ? "Hide Key" : "Show Key"}
            </button>
            <button
              type="button"
              onClick={() => {
                setApiKey("");
                setTransientNotice("success", "Stored API key cleared.");
              }}
              style={buttonBase}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              style={{
                ...buttonBase,
                background: palette.accentSoft,
                borderColor: palette.accent,
              }}
            >
              {theme === "dark" ? "Light Theme" : "Dark Theme"}
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(MODE_CONFIG).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              style={{
                ...buttonBase,
                background: mode === key ? palette.accentSoft : palette.panelAlt,
                borderColor: mode === key ? palette.accent : palette.border,
                color: mode === key ? palette.text : palette.textSoft,
                fontWeight: mode === key ? 700 : 500,
              }}
            >
              <span>{item.label}</span>
              <span>{item.icon}</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(VIEW_CONFIG).map(([key, item]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                style={{
                  ...buttonBase,
                  background: view === key ? palette.accentSoft : palette.panelAlt,
                  borderColor: view === key ? palette.accent : palette.border,
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: palette.panelAlt,
              border: `1px solid ${palette.border}`,
              color: palette.textSoft,
              fontSize: 12,
            }}
          >
Ctrl/Cmd+Enter Analyze ? Ctrl/Cmd+D Diff ? Ctrl/Cmd+K Chat
          </div>
        </div>
      </div>
    </div>
  );

  const renderExplorerNode = (node, depth = 0) => {
    if (node.type === "folder") {
      const isCollapsed = !!collapsedFolders[node.path];
      const safeActiveFile = String(activeFile || "");
      const isActiveBranch =
        safeActiveFile === node.path || safeActiveFile.startsWith(`${node.path}/`);

      return (
        <div key={node.path} style={{ display: "flex", flexDirection: "column" }}>
          <button
            type="button"
            onClick={() => toggleFolder(node.path)}
            style={{
              border: "none",
              background: isActiveBranch ? palette.selection : "transparent",
              color: isActiveBranch ? palette.text : palette.textSoft,
              padding: "4px 8px",
              paddingLeft: 8 + depth * 14,
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              width: "100%",
              minHeight: 24,
            }}
          >
            <span style={{ fontSize: 10, width: 12 }}>{isCollapsed ? "▶" : "▼"}</span>
            <span style={{ fontSize: 14 }}>📁</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
              title={node.path}
            >
              {node.name}
            </span>
          </button>
          {!isCollapsed ? node.children.map((child) => renderExplorerNode(child, depth + 1)) : null}
        </div>
      );
    }

    const file = node.file;
    const result = results[file.name];
    const itemLoading = !!loading[file.name];
    const parentPath = getParentPath(file.name);

    const getFileIcon = (lang) => {
      const icons = {
        javascript: "📜",
        typescript: "📘",
        python: "🐍",
        html: "🌐",
        css: "🎨",
        json: "📋",
        md: "📝",
        jsx: "⚛️",
        tsx: "⚛️",
        vue: "💚",
        svelte: "🔥",
        default: "📄",
      };
      return icons[lang] || icons.default;
    };

    return (
      <button
        key={node.path}
        type="button"
        onClick={() => openFileInEditor(file.name)}
        style={{
          border: "none",
          background: activeFile === file.name ? `${palette.accent}25` : "transparent",
          borderRadius: 4,
          padding: "4px 8px",
          paddingLeft: 24 + depth * 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          color: palette.text,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 13,
          width: "100%",
          transition: "background 0.1s ease",
        }}
      >
        <span style={{ fontSize: 14 }}>{getFileIcon(file.lang)}</span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={file.name}
        >
          {getBaseName(file.name)}
        </span>
        {itemLoading ? (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: palette.accent,
              animation: "pulse 1.2s infinite",
            }}
          />
        ) : typeof result?.score === "number" && !result?.error ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: scoreColor(result.score),
            }}
          >
            {result.score}
          </span>
        ) : null}
      </button>
    );
  };

  const renderSidebar = () => (
    <div
      style={{
        ...panelStyle,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
        background: palette.sideBar,
        border: "none",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 6,
          background: aiBannerBackground,
          border: `1px solid ${aiBannerBorder}`,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
          {hasApiKey ? "Cloud AI Connected" : "Local AI Ready"}
        </div>
        <div style={{ fontSize: 11, color: palette.textSoft, marginBottom: 8 }}>
          {aiAvailabilityText}
        </div>
        {!hasApiKey && (
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-ant-..."
            style={{
              ...inputBase,
              fontSize: 11,
              padding: "6px 8px",
            }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...buttonBase, flex: 1, justifyContent: "center", fontSize: 11, padding: "6px 8px" }}>
          📄 Open File
        </button>
        <button
          type="button"
          onClick={launchFolderPicker}
          style={{
            ...buttonBase,
            flex: 1,
            justifyContent: "center",
            background: palette.accentSoft,
            borderColor: palette.accent,
            fontSize: 11,
            padding: "6px 8px",
          }}
        >
          📁 Open Folder
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        style={{ display: "none" }}
        onChange={handleFolderInputChange}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", color: palette.textSoft, letterSpacing: 0.5 }}>
            Explorer
          </div>
          <div style={{ color: palette.textMuted, fontSize: 11 }}>{files.length} files</div>
        </div>
        
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflow: "auto",
            minHeight: 0,
            padding: 4,
            borderRadius: 8,
            background: palette.codeBg,
            flex: 1,
          }}
        >
          {!files.length ? (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                color: palette.textMuted,
                fontSize: 12,
              }}
            >
              No files loaded.<br />
              Open a file or folder to start.
            </div>
          ) : (
            fileTree.map((node) => renderExplorerNode(node))
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => activeFileData && analyzeFile(activeFileData)}
        disabled={!activeFileData || !canUseAiFeatures || !!loading[activeFile]}
        style={{
          ...buttonBase,
          justifyContent: "center",
          background: palette.accent,
          borderColor: palette.accent,
          color: "#ffffff",
          fontWeight: 600,
          padding: "10px",
          opacity: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? 0.5 : 1,
          cursor: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? "not-allowed" : "pointer",
        }}
      >
        {loading[activeFile] ? "⏳ Analyzing..." : "🤖 Analyze Code"}
      </button>
    </div>
  );

  const renderCodeRows = (content, type = "code") => {
    const lines = String(content || "").split("\n");
    return (
      <div
        style={{
          borderRadius: 18,
          border: `1px solid ${palette.border}`,
          background: palette.codeBg,
          overflow: "auto",
          minHeight: 0,
          flex: 1,
        }}
      >
        {lines.map((line, index) => (
          <div
            key={`${type}-${index + 1}`}
            style={{
              display: "flex",
              borderBottom: `1px solid ${palette.border}40`,
              background: index % 2 === 0 ? "transparent" : `${palette.panelAlt}70`,
            }}
          >
            <div
              style={{
                width: 58,
                minWidth: 58,
                textAlign: "right",
                padding: "10px 12px",
                color: palette.textMuted,
                borderRight: `1px solid ${palette.border}`,
                userSelect: "none",
              }}
            >
              {index + 1}
            </div>
            <div
              style={{
                padding: "10px 14px",
                whiteSpace: "pre",
                minWidth: "100%",
              }}
            >
              {line || " "}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderEditorCenter = () => (
    <div
      style={{
        ...panelStyle,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: 0,
      }}
    >
      {!activeFileData ? (
        <div
          style={{
            flex: 1,
            minHeight: 420,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 440 }}>
            <div style={{ fontSize: 42, marginBottom: 12, fontWeight: 800 }}>AI</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Your review workspace is empty</div>
            <div style={{ color: palette.textSoft, lineHeight: 1.8 }}>
              Add files from the sidebar, paste a snippet manually, then press Analyze to generate a production-style review and fixed output.
            </div>
            <div style={{ marginTop: 16, color: palette.textMuted, fontSize: 12 }}>
              Shortcuts: Ctrl/Cmd+Enter Analyze | Ctrl/Cmd+D Diff | Ctrl/Cmd+K Chat
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  display: "grid",
                  placeItems: "center",
                  background: palette.accentSoft,
                  border: `1px solid ${palette.accent}`,
                  fontSize: 20,
                }}
              >
                {getLanguageIcon(activeFileData.lang)}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{activeFileData.name}</div>
                <div style={{ color: palette.textSoft, fontSize: 12 }}>
                  {countLines(activeFileData.content)} lines | {capitalize(activeFileData.lang)}
                </div>
              </div>
            </div>

            {activeResult && !activeResult.error ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: `${scoreColor(activeResult.score)}1A`,
                    border: `1px solid ${scoreColor(activeResult.score)}4D`,
                    color: scoreColor(activeResult.score),
                    fontWeight: 800,
                  }}
                >
                  Score {activeResult.score}
                </div>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: `${gradeColor(activeResult.grade)}1A`,
                    border: `1px solid ${gradeColor(activeResult.grade)}4D`,
                    color: gradeColor(activeResult.grade),
                    fontWeight: 800,
                  }}
                >
                  Grade {activeResult.grade}
                </div>
                <button type="button" onClick={handleCopyFixedCode} style={buttonBase}>
                  {copiedAll ? "Copied!" : "Copy Fixed Code"}
                </button>
                <button
                  type="button"
                  onClick={() => setView((prev) => (prev === "diff" ? "editor" : "diff"))}
                  style={{
                    ...buttonBase,
                    borderColor: palette.accent,
                    background: palette.accentSoft,
                  }}
                >
                  Open Diff (Ctrl/Cmd+D)
                </button>
              </div>
            ) : null}
          </div>

          {renderCodeRows(activeFileData.content, "editor")}
        </>
      )}
    </div>
  );
  const renderDiffCenter = () => (
    <div
      style={{
        ...panelStyle,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: 0,
      }}
    >
      {!activeFileData ? (
        <div
          style={{
            minHeight: 420,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            color: palette.textSoft,
            lineHeight: 1.8,
          }}
        >
          Choose a file to view its diff output.
        </div>
      ) : !activeResult || activeResult.error ? (
        <div
          style={{
            minHeight: 420,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            color: palette.textSoft,
            lineHeight: 1.8,
          }}
        >
          Run an analysis first to compare the original file against Claude&apos;s corrected version.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Line-by-line Diff</div>
              <div style={{ color: palette.textSoft, fontSize: 12 }}>
                Comparing original source with AI-fixed output for {activeFileData.name}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 999,
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.24)",
                  color: "#fda4af",
                }}
              >
                Removed {diffStats.remove}
              </div>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 999,
                  background: "rgba(34,197,94,0.12)",
                  border: "1px solid rgba(34,197,94,0.24)",
                  color: "#86efac",
                }}
              >
                Added {diffStats.add}
              </div>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 999,
                  background: palette.panelAlt,
                  border: `1px solid ${palette.border}`,
                  color: palette.textSoft,
                }}
              >
                Unchanged {diffStats.same}
              </div>
            </div>
          </div>

          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${palette.border}`,
              background: palette.codeBg,
              overflow: "auto",
              minHeight: 0,
              flex: 1,
            }}
          >
            {diffRows.map((row, index) => {
              const bg =
                row.type === "add"
                  ? "rgba(34,197,94,0.12)"
                  : row.type === "remove"
                    ? "rgba(239,68,68,0.12)"
                    : index % 2 === 0
                      ? "transparent"
                      : `${palette.panelAlt}70`;
              const markerColor =
                row.type === "add"
                  ? "#22c55e"
                  : row.type === "remove"
                    ? "#ef4444"
                    : palette.textMuted;
              const marker = row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
              return (
                <div
                  key={`diff-${index}`}
                  style={{
                    display: "flex",
                    borderBottom: `1px solid ${palette.border}40`,
                    background: bg,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      minWidth: 28,
                      textAlign: "center",
                      padding: "10px 6px",
                      color: markerColor,
                      fontWeight: 800,
                    }}
                  >
                    {marker}
                  </div>
                  <div
                    style={{
                      width: 54,
                      minWidth: 54,
                      textAlign: "right",
                      padding: "10px 10px",
                      color: palette.textMuted,
                      borderRight: `1px solid ${palette.border}`,
                    }}
                  >
                    {row.lineA ?? ""}
                  </div>
                  <div
                    style={{
                      width: 54,
                      minWidth: 54,
                      textAlign: "right",
                      padding: "10px 10px",
                      color: palette.textMuted,
                      borderRight: `1px solid ${palette.border}`,
                    }}
                  >
                    {row.lineB ?? ""}
                  </div>
                  <div style={{ padding: "10px 14px", whiteSpace: "pre", minWidth: "100%" }}>
                    {row.text || " "}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  const renderCodeCenter = () => {
    if (!activeFileData) {
      return (
        <div
          style={{
            ...panelStyle,
            minHeight: 420,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            color: palette.textSoft,
            lineHeight: 1.8,
          }}
        >
          Open a file to show its source code in the middle editor area.
        </div>
      );
    }

    const content = String(activeFileData.content || "");
    const lines = content.split("\n");
    const fontSize = clampNumber(
      editorSettings.fontSize,
      10,
      24,
      DEFAULT_EDITOR_SETTINGS.fontSize
    );

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "56px minmax(0, 1fr)",
          overflow: "hidden",
          background: palette.codeBg,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            overflow: "hidden auto",
            borderRight: `1px solid ${palette.border}`,
            background: palette.panel,
            color: palette.textMuted,
            fontFamily: EDITOR_FONT,
            fontSize,
            lineHeight: 1.7,
            padding: "12px 8px 12px 0",
            textAlign: "right",
            userSelect: "none",
          }}
        >
          {lines.map((_, index) => (
            <div key={`center-code-line-${index + 1}`}>{index + 1}</div>
          ))}
        </div>

        <div
          style={{
            overflow: "auto",
            padding: "12px 16px",
          }}
        >
          <pre
            style={{
              margin: 0,
              minHeight: "100%",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: palette.text,
              fontFamily: EDITOR_FONT,
              fontSize,
              lineHeight: 1.7,
            }}
          >
            {content || " "}
          </pre>
        </div>
      </div>
    );
  };

  const renderResultsPanel = () => {
    if (!activeFileData) {
      return (
        <div
          style={{
            ...panelStyle,
            padding: 18,
            display: "grid",
            placeItems: "center",
            minHeight: 420,
            textAlign: "center",
            color: palette.textSoft,
            lineHeight: 1.8,
          }}
        >
          Analyze a file to populate the review summary, issue breakdown, and improvement tips.
        </div>
      );
    }

    if (!activeResult) {
      return (
        <div
          style={{
            ...panelStyle,
            padding: 18,
            display: "grid",
            placeItems: "center",
            minHeight: 420,
            textAlign: "center",
            color: palette.textSoft,
            lineHeight: 1.8,
          }}
        >
          No analysis yet for {activeFileData.name}. Use the sidebar actions or Ctrl/Cmd+Enter to get started.
        </div>
      );
    }

    if (activeResult.error) {
      return (
        <div style={{ ...panelStyle, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: "rgba(239,68,68,0.09)",
              border: "1px solid rgba(239,68,68,0.24)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Analysis Error</div>
            <div style={{ color: palette.textSoft, lineHeight: 1.7 }}>{activeResult.error}</div>
          </div>
          <div style={{ color: palette.textSoft, fontSize: 12 }}>
            Check the API key, confirm network access to Anthropic, and retry the current file.
          </div>
        </div>
      );
    }

    const severityCounts = getSeverityCounts(activeResult.issues || []);
    const reviewTopIssue =
      activeResult.issues?.find((issue) => issue.severity !== "info") ||
      activeResult.issues?.[0] ||
      null;
    const metricCards = [
      { key: "complexity", label: "Complex" },
      { key: "maintainability", label: "Maintain" },
      { key: "testability", label: "Testing" },
      { key: "documentation", label: "Docs" },
    ];
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "auto",
          paddingRight: 2,
        }}
      >
        <div
          style={{
            padding: 14,
            borderRadius: 16,
            border: `1px solid ${palette.border}`,
            background: `linear-gradient(135deg, ${palette.accentSoft}, ${palette.panelAlt})`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span
                className="codesense-mono"
                style={{
                  padding: "4px 7px",
                  borderRadius: 4,
                  background: palette.accent,
                  color: "#ffffff",
                  fontSize: 10,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {MODE_CONFIG[activeResult.mode]?.icon || "FULL"}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: palette.text }}>
                  {MODE_CONFIG[activeResult.mode]?.label || capitalize(activeResult.mode)}
                </div>
                <div style={{ color: palette.textSoft, fontSize: 11, marginTop: 4 }}>
                  {formatTimestamp(activeResult.timestamp)}
                </div>
              </div>
            </div>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${scoreColor(activeResult.score)}44`,
                background: `${scoreColor(activeResult.score)}16`,
                color: scoreColor(activeResult.score),
                fontSize: 11,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              Score {activeResult.score}
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              lineHeight: 1.65,
              fontSize: 13,
              color: palette.text,
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {activeResult.summary}
          </div>
          {reviewTopIssue ? (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: `1px solid ${palette.border}`,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  padding: "3px 7px",
                  borderRadius: 999,
                  background: `${SEV_COLOR[reviewTopIssue.severity]}16`,
                  border: `1px solid ${SEV_COLOR[reviewTopIssue.severity]}38`,
                  color: SEV_COLOR[reviewTopIssue.severity],
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                {reviewTopIssue.severity}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 12,
                    fontWeight: 700,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {reviewTopIssue.title}
                </div>
                <div style={{ color: palette.textSoft, fontSize: 11, marginTop: 3 }}>
                  {reviewTopIssue.category}
                  {reviewTopIssue.line ? ` | line ${reviewTopIssue.line}` : ""}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          {metricCards.map(({ key, label }) => (
            <div
              key={key}
              style={{
                padding: "10px 12px",
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.codeBg,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  color: palette.textSoft,
                  fontSize: 10,
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {label}
              </div>
              <div style={{ color: metricColor(key, activeResult.metrics[key]), fontWeight: 800, fontSize: 12 }}>
                {String(activeResult.metrics[key] || "medium").toUpperCase()}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => setRightTab("issues")}
            style={{
              ...buttonBase,
              flex: 1,
              justifyContent: "center",
              background: rightTab === "issues" ? palette.accentSoft : palette.panelAlt,
              borderColor: rightTab === "issues" ? palette.accent : palette.border,
            }}
          >
            Issues ({filteredIssues.length}/{activeResult.issues.length})
          </button>
          <button
            type="button"
            onClick={() => setRightTab("improvements")}
            style={{
              ...buttonBase,
              flex: 1,
              justifyContent: "center",
              background: rightTab === "improvements" ? palette.accentSoft : palette.panelAlt,
              borderColor: rightTab === "improvements" ? palette.accent : palette.border,
            }}
          >
            Tips ({activeResult.improvements.length})
          </button>
        </div>

        {rightTab === "issues" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={searchQ}
                onChange={(event) => setSearchQ(event.target.value)}
                placeholder="Search issues by title, description, category, or severity..."
                style={inputBase}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["all", ...VALID_SEVERITIES].map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setFilterSev(sev)}
                    style={{
                      ...buttonBase,
                      padding: "8px 12px",
                      background: filterSev === sev ? palette.accentSoft : palette.panelAlt,
                      borderColor:
                        filterSev === sev
                          ? palette.accent
                          : sev === "all"
                            ? palette.border
                            : `${SEV_COLOR[sev]}50`,
                      color: sev === "all" ? palette.textSoft : SEV_COLOR[sev],
                    }}
                  >
                    {sev === "all" ? "All" : sev}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {!filteredIssues.length ? (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: `1px solid ${palette.border}`,
                    background: palette.codeBg,
                    color: palette.textSoft,
                    lineHeight: 1.8,
                  }}
                >
                  No issues match the current filter. Try broadening the search or switch to the Tips tab for general improvements.
                </div>
              ) : (
                filteredIssues.map((issue) => {
                  const key = `${activeFileData.name}::${issue.id}`;
                  const expanded = !!expandedIssues[key];
                  return (
                    <div
                      key={key}
                      style={{
                        borderRadius: 14,
                        border: `1px solid ${SEV_COLOR[issue.severity]}22`,
                        background: `${SEV_COLOR[issue.severity]}12`,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1 }}>
                          <span
                            style={{
                              marginTop: 7,
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: SEV_COLOR[issue.severity],
                              boxShadow: `0 0 16px ${SEV_COLOR[issue.severity]}`,
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                              <span
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  border: `1px solid ${SEV_COLOR[issue.severity]}50`,
                                  color: SEV_COLOR[issue.severity],
                                  background: `${SEV_COLOR[issue.severity]}14`,
                                  fontSize: 11,
                                  textTransform: "uppercase",
                                }}
                              >
                                {issue.severity}
                              </span>
                              <span
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  border: `1px solid ${palette.border}`,
                                  color: palette.textSoft,
                                  background: palette.panelAlt,
                                  fontSize: 11,
                                }}
                              >
                                {issue.category}
                              </span>
                              <span
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  border: `1px solid ${palette.border}`,
                                  color: palette.textSoft,
                                  background: palette.panelAlt,
                                  fontSize: 11,
                                }}
                              >
                                Line {issue.line ?? "n/a"}
                              </span>
                            </div>
                            <div style={{ fontWeight: 800, lineHeight: 1.5 }}>{issue.title}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIssues((prev) => ({
                              ...prev,
                              [key]: !prev[key],
                            }))
                          }
                          style={{
                            border: "none",
                            background: "transparent",
                            color: palette.textSoft,
                            cursor: "pointer",
                            fontSize: 15,
                          }}
                        >
                          {expanded ? "Hide" : "Show"}
                        </button>
                      </div>

                      {expanded ? (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ color: palette.textSoft, lineHeight: 1.8 }}>{issue.description}</div>
                          {issue.fix ? (
                            <div
                              style={{
                                borderRadius: 14,
                                overflow: "hidden",
                                border: `1px solid ${palette.border}`,
                                background: palette.codeBg,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: "10px 12px",
                                  borderBottom: `1px solid ${palette.border}`,
                                }}
                              >
                                <div style={{ fontWeight: 700 }}>Suggested Fix</div>
                                <button
                                  type="button"
                                  onClick={() => handleCopyIssueFix(activeFileData.name, issue.id, issue.fix)}
                                  style={buttonBase}
                                >
                                  {copiedFixes[key] ? "Copied!" : "Copy"}
                                </button>
                              </div>
                              <pre
                                style={{
                                  margin: 0,
                                  padding: 14,
                                  overflow: "auto",
                                  whiteSpace: "pre-wrap",
                                  color: palette.text,
                                }}
                              >
                                {issue.fix}
                              </pre>
                            </div>
                          ) : null}
                          {issue.explanation ? (
                            <div style={{ fontStyle: "italic", color: palette.textSoft, lineHeight: 1.8 }}>
                              {issue.explanation}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!activeResult.improvements.length ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  color: palette.textSoft,
                }}
              >
                No extra tips returned for this file.
              </div>
            ) : (
              activeResult.improvements.map((tip, index) => (
                <div
                  key={`tip-${index}`}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(34,197,94,0.25)",
                    background: "rgba(34,197,94,0.07)",
                    lineHeight: 1.8,
                    color: palette.text,
                  }}
                >
                  <span style={{ marginRight: 8, fontWeight: 700 }}>Tip:</span>
                  {tip}
                </div>
              ))
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            color: palette.textSoft,
            fontSize: 11,
          }}
        >
          {Object.entries(severityCounts).map(([severity, count]) => (
            <span
              key={severity}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${severity === "critical" ? "rgba(255,59,59,0.28)" : palette.border}`,
                background: severity === "critical" ? "rgba(255,59,59,0.08)" : palette.panelAlt,
                color: SEV_COLOR[severity],
              }}
            >
              {severity}: {count}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderDashboard = () => {
    const dashboardFiles = [...files].sort((left, right) => {
      const leftAnalyzed = Boolean(results[left.name] && !results[left.name]?.error);
      const rightAnalyzed = Boolean(results[right.name] && !results[right.name]?.error);
      if (leftAnalyzed !== rightAnalyzed) return rightAnalyzed ? 1 : -1;

      const leftLoading = Boolean(loading[left.name]);
      const rightLoading = Boolean(loading[right.name]);
      if (leftLoading !== rightLoading) return rightLoading ? 1 : -1;

      return left.name.localeCompare(right.name);
    });

    return (
    <div
      style={{
        ...panelStyle,
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompact ? "1fr" : "repeat(4, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {[
          { label: "Files Analyzed", value: analyzedFiles.length, icon: "FILES", color: palette.accent },
          { label: "Avg Quality", value: analyzedFiles.length ? `${avgQuality}` : "0", icon: "AVG", color: "#22c55e" },
          { label: "Total Issues", value: totalIssues, icon: "ISSUES", color: "#f59e0b" },
          { label: "Critical Issues", value: criticalIssues, icon: "CRIT", color: "#ef4444" },
        ].map((card) => (
          <div key={card.label} style={{ ...panelStyle, padding: 18 }}>
            <div style={{ color: palette.textSoft, fontSize: 12, marginBottom: 12 }}>{card.label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <div
                style={{
                  minWidth: isCompact ? 58 : 66,
                  height: 44,
                  padding: "0 12px",
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `${card.color}18`,
                  border: `1px solid ${card.color}40`,
                  color: card.color,
                  fontSize: isCompact ? 13 : 14,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {card.icon}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap" }}>
                {card.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          ...panelStyle,
          padding: 18,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Portfolio Overview</div>
          <div style={{ color: palette.textSoft, fontSize: 12 }}>
            Review repo health across files, then drill back into Editor or Diff with one click.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={handleExportReport} style={buttonBase}>
            Export HTML Report
          </button>
          <button
            type="button"
            onClick={analyzeAll}
            disabled={!files.length || !canUseAiFeatures}
            style={{
              ...buttonBase,
              opacity: !files.length || !canUseAiFeatures ? 0.6 : 1,
              cursor: !files.length || !canUseAiFeatures ? "not-allowed" : "pointer",
            }}
          >
            Re-analyze All
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompact ? "1fr" : "repeat(2, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        <div style={{ ...panelStyle, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 800 }}>Backend Connection</div>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${serverHealthColor}55`,
                background: `${serverHealthColor}18`,
                color: serverHealthColor,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {serverHealthLabel}
            </span>
          </div>
          <div style={{ color: palette.textSoft, fontSize: 13, lineHeight: 1.7 }}>
            {serverHealth.message}
          </div>
          <div style={{ color: palette.textMuted, fontSize: 12 }}>
            {workspaceId
              ? "Workspace sync is active and saved reviews will stay attached to this workspace."
              : "A workspace record will be created automatically on the first successful save or review."}
          </div>
        </div>

        <div style={{ ...panelStyle, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Saved Review History</div>
          {!reviewHistory.length ? (
            <div style={{ color: palette.textSoft, fontSize: 13, lineHeight: 1.7 }}>
              No saved reviews yet. Run analysis on a file and the result will be stored through the backend.
            </div>
          ) : (
            reviewHistory.slice(0, 5).map((review) => (
              <button
                key={review._id || `${review.fileName}-${review.createdAt}`}
                type="button"
                onClick={() => {
                  if (review.fileName && files.some((item) => item.name === review.fileName)) {
                    setActiveFile(review.fileName);
                    setView("editor");
                  }
                }}
                style={{
                  ...buttonBase,
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: palette.codeBg,
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {review.fileName}
                  </span>
                  <span style={{ fontSize: 11, color: palette.textSoft }}>
                    {MODE_CONFIG[review.mode]?.label || capitalize(review.mode || "review")}
                  </span>
                </span>
                <span style={{ color: scoreColor(review.score), fontWeight: 700, fontSize: 12 }}>
                  {typeof review.score === "number" ? `${review.score}` : review.grade || "--"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: 16,
        }}
      >
        {!files.length ? (
          <div
            style={{
              ...panelStyle,
              padding: 28,
              color: palette.textSoft,
              lineHeight: 1.8,
            }}
          >
            Add files in the Editor view to populate the dashboard.
          </div>
        ) : (
          dashboardFiles.map((file) => {
            const result = results[file.name];
            const severityCounts = getSeverityCounts(result?.issues || []);
            const topIssue =
              result?.issues?.find((issue) => issue.severity !== "info") ||
              result?.issues?.[0] ||
              null;
            const topIssueTitle =
              topIssue && /no obvious hot spots|completed with no obvious hot spots/i.test(topIssue.title)
                ? "No obvious hot spots found"
                : topIssue?.title || "";
            const metricEntries = result?.metrics
              ? [
                  { metric: "complexity", label: "Complex" },
                  { metric: "maintainability", label: "Maintain" },
                  { metric: "testability", label: "Testing" },
                  { metric: "documentation", label: "Docs" },
                ].map(({ metric, label }) => ({
                  metric,
                  label,
                  value: result.metrics[metric] || "medium",
                }))
              : [];
            return (
              <div
                key={file.name}
                onClick={() => {
                  setActiveFile(file.name);
                  setView("editor");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveFile(file.name);
                    setView("editor");
                  }
                }}
                role="button"
                tabIndex={0}
                style={{
                  ...panelStyle,
                  padding: 18,
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 14,
                        display: "grid",
                        placeItems: "center",
                        background: palette.accentSoft,
                        border: `1px solid ${palette.accent}`,
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      {getLanguageIcon(file.lang)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 800,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {file.name}
                      </div>
                      <div style={{ color: palette.textSoft, fontSize: 12 }}>
                        {capitalize(file.lang)} | {countLines(file.content)} lines
                      </div>
                    </div>
                  </div>
                  {loading[file.name] ? (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: palette.accent,
                        boxShadow: `0 0 14px ${palette.accent}`,
                        animation: "pulse 1.2s infinite",
                      }}
                    />
                  ) : null}
                </div>

                {result && !result.error ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 999,
                          background: `${scoreColor(result.score)}18`,
                          border: `1px solid ${scoreColor(result.score)}40`,
                          color: scoreColor(result.score),
                          fontWeight: 800,
                        }}
                      >
                        {result.score}
                      </div>
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 999,
                          background: `${gradeColor(result.grade)}18`,
                          border: `1px solid ${gradeColor(result.grade)}40`,
                          color: gradeColor(result.grade),
                          fontWeight: 800,
                        }}
                      >
                        {result.grade}
                      </div>
                    </div>
                    <div
                      style={{
                        height: 9,
                        borderRadius: 999,
                        background: palette.codeBg,
                        overflow: "hidden",
                        border: `1px solid ${palette.border}`,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${result.score}%`,
                          background: `linear-gradient(90deg, ${scoreColor(result.score)}, ${palette.accent})`,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 16,
                        border: `1px solid ${palette.border}`,
                        background: palette.codeBg,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          color: palette.textSoft,
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: 1.1,
                        }}
                      >
                        Analysis Summary
                      </div>
                      <div
                        style={{
                          color: palette.text,
                          fontSize: 12,
                          lineHeight: 1.6,
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {result.summary}
                      </div>
                      {topIssue ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              padding: "4px 8px",
                              borderRadius: 999,
                              background: `${SEV_COLOR[topIssue.severity]}16`,
                              border: `1px solid ${SEV_COLOR[topIssue.severity]}38`,
                              color: SEV_COLOR[topIssue.severity],
                              fontSize: 10,
                              fontWeight: 800,
                              flexShrink: 0,
                            }}
                          >
                            {topIssue.severity.toUpperCase()}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                color: palette.text,
                                fontSize: 12,
                                fontWeight: 700,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {topIssueTitle}
                            </div>
                            <div style={{ color: palette.textSoft, fontSize: 11, marginTop: 4 }}>
                              {topIssue.category}
                              {topIssue.line ? ` | line ${topIssue.line}` : ""}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 8,
                      }}
                    >
                      {metricEntries.map(({ metric, label, value }) => (
                        <div
                          key={metric}
                          style={{
                            padding: "9px 10px",
                            borderRadius: 14,
                            border: `1px solid ${palette.border}`,
                            background: palette.codeBg,
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              color: palette.textSoft,
                              fontSize: 9,
                              textTransform: "uppercase",
                              letterSpacing: 0.7,
                              marginBottom: 6,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {label}
                          </div>
                          <div style={{ color: metricColor(metric, value), fontWeight: 800, fontSize: 12 }}>
                            {String(value).toUpperCase()}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {Object.entries(severityCounts)
                        .filter(([, count]) => count > 0)
                        .map(([severity, count]) => (
                          <span
                            key={severity}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 999,
                              background: `${SEV_COLOR[severity]}14`,
                              border: `1px solid ${SEV_COLOR[severity]}35`,
                              color: SEV_COLOR[severity],
                              fontSize: 11,
                            }}
                          >
                            {severity}: {count}
                          </span>
                        ))}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      analyzeFile(file);
                    }}
                    disabled={!canUseAiFeatures}
                    style={{
                      ...buttonBase,
                      justifyContent: "center",
                      width: "100%",
                      opacity: !canUseAiFeatures ? 0.6 : 1,
                      cursor: !canUseAiFeatures ? "not-allowed" : "pointer",
                    }}
                  >
                    Analyze Now
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
    );
  };
  const renderChat = () => {
    const quickPrompts = [
      "Explain this code",
      "Find all bugs",
      "How to optimize?",
      "Write unit tests",
      "What patterns are used?",
      "Add error handling",
    ];
    const selectedFreeModel = getChatModelOption(FREE_CHAT_MODELS, primaryChatModel);
    const primaryApprovalLabel =
      SECONDARY_APPROVAL_OPTIONS.find((item) => item.value === primaryApprovalMode)?.label ||
      "Default Approvals";
    const primaryContextLabel =
      primaryContextScope === "workspace" ? "Workspace Context" : "Focused Context";
    const primarySessionPreview = primaryChatMsgs
      .filter((msg) => msg.role === "user")
      .slice(-3)
      .reverse();

    return (
      <div
        style={{
          ...panelStyle,
          flex: 1,
          minHeight: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: isCompact ? "1fr" : "250px minmax(0, 1fr)",
          overflow: "hidden",
          background: palette.codeBg,
        }}
      >
        <div
          style={{
            borderRight: isCompact ? "none" : `1px solid ${palette.border}`,
            borderBottom: isCompact ? `1px solid ${palette.border}` : "none",
            background: palette.sideBar,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          <div>
            <div style={sectionLabelStyle}>Chat</div>
            <div style={{ fontWeight: 800, fontSize: 19, marginTop: 8 }}>Free Assistant</div>
            <div style={{ color: palette.textSoft, fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
              Use the main chat page for quick free help, architecture questions, bug triage, and planning.
            </div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 16,
              border: `1px solid ${palette.border}`,
              background: palette.panel,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ color: palette.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.9 }}>
              Current Context
            </div>
            <div style={{ fontSize: 13, color: palette.text, lineHeight: 1.6 }}>
              {activeFileData ? activeFileData.name : "Workspace-wide free chat"}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${palette.accent}44`,
                  background: `${palette.accent}16`,
                  color: palette.accent,
                  fontSize: 11,
                }}
              >
                {selectedFreeModel.label}
              </span>
              <span
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  color: palette.textSoft,
                  fontSize: 11,
                }}
              >
                Free Route
              </span>
            </div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 16,
              border: `1px solid ${palette.border}`,
              background: palette.panel,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ color: palette.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.9 }}>
              Free Chat Process
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  color: palette.textSoft,
                  fontSize: 11,
                }}
              >
                {SECONDARY_AGENT_OPTIONS.find((item) => item.value === primaryAgentMode)?.label || "Agent"}
              </span>
              <span
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  color: palette.textSoft,
                  fontSize: 11,
                }}
              >
                {SECONDARY_DEPTH_OPTIONS.find((item) => item.value === primaryDepthMode)?.label || "Auto"}
              </span>
            </div>
            <div style={{ color: palette.textSoft, fontSize: 12, lineHeight: 1.7 }}>
              Main chat uses the same assistant flow as Secondary Chat, but stays on the free-model path.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={sectionLabelStyle}>Sessions</div>
            <button
              type="button"
              onClick={() => {
                setPrimaryChatMsgs([]);
                setPrimaryChatInput("");
              }}
              style={{ ...buttonBase, padding: "6px 10px", minHeight: 26, fontSize: 11 }}
            >
              New
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!primarySessionPreview.length ? (
              <div
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: `1px dashed ${palette.border}`,
                  color: palette.textSoft,
                  fontSize: 12,
                  lineHeight: 1.7,
                  background: palette.panel,
                }}
              >
                No saved prompts yet. Start with a quick prompt or type your own request.
              </div>
            ) : (
              primarySessionPreview.map((msg, index) => (
                <button
                  key={`primary-session-${index}`}
                  type="button"
                  onClick={() => setPrimaryChatInput(msg.content)}
                  style={{
                    ...buttonBase,
                    justifyContent: "flex-start",
                    textAlign: "left",
                    whiteSpace: "normal",
                    lineHeight: 1.5,
                    padding: "10px 12px",
                  }}
                >
                  {msg.content}
                </button>
              ))
            )}
          </div>

          <div style={sectionLabelStyle}>Quick Prompts</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => sendPrimaryChatMessage(prompt)}
                style={{ ...buttonBase, justifyContent: "flex-start", textAlign: "left" }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "16px 18px 14px",
              borderBottom: `1px solid ${palette.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              background: palette.panel,
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Chat</div>
              <div style={{ color: palette.textSoft, fontSize: 12, marginTop: 6 }}>
                Free-model workspace chat with file-aware context and quick prompts.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.panelAlt,
                  color: palette.textSoft,
                  fontSize: 11,
                }}
              >
                {primaryChatMsgs.length} msg
              </span>
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${palette.accent}44`,
                  background: `${palette.accent}16`,
                  color: palette.accent,
                  fontSize: 11,
                }}
              >
                {selectedFreeModel.badge}
              </span>
            </div>
          </div>

          <div
            ref={primaryChatScrollRef}
            style={{
              flex: 1,
              minHeight: 280,
              overflow: "auto",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              background: palette.codeBg,
            }}
          >
            {!primaryChatMsgs.length ? (
              <div
                style={{
                  minHeight: 260,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div
                  style={{
                    width: "min(520px, 100%)",
                    padding: 20,
                    borderRadius: 20,
                    border: `1px solid ${palette.border}`,
                    background: palette.panel,
                    color: palette.textSoft,
                    textAlign: "center",
                    lineHeight: 1.8,
                  }}
                >
                  Start a free conversation about the active file, the current workspace, or the next change you want to make.
                </div>
              </div>
            ) : (
              primaryChatMsgs.map((msg, index) => (
                <div
                  key={`msg-${index}`}
                  style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "min(780px, 88%)",
                    padding: 14,
                    borderRadius: 18,
                    border: `1px solid ${
                      msg.role === "user" ? `${palette.accent}55` : palette.border
                    }`,
                    background: msg.role === "user" ? palette.accentSoft : palette.panel,
                  }}
                >
                  {msg.role === "assistant" ? (
                    <div style={{ color: palette.textSoft, fontSize: 11, marginBottom: 8 }}>
                      Free Chat
                    </div>
                  ) : null}
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}>{msg.content}</div>
                </div>
              ))
            )}

            {primaryChatLoading ? (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: 14,
                  borderRadius: 18,
                  border: `1px solid ${palette.border}`,
                  background: palette.panel,
                  color: palette.textSoft,
                }}
              >
                Free model thinking...
              </div>
            ) : null}
          </div>

          <div
            style={{
              padding: 16,
              borderTop: `1px solid ${palette.border}`,
              background: palette.panelAlt,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                border: `1px solid ${palette.border}`,
                background: palette.panel,
                borderRadius: 14,
                overflow: "visible",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <textarea
                value={primaryChatInput}
                onChange={(event) => setPrimaryChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendPrimaryChatMessage();
                  }
                }}
                placeholder="Describe what to build, review, debug, test, or explain..."
                style={{
                  width: "100%",
                  minHeight: 96,
                  resize: "vertical",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: palette.text,
                  padding: "14px 14px 10px",
                  fontFamily: UI_FONT,
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              />
              <div
                style={{
                  borderTop: `1px solid ${palette.border}`,
                  padding: "10px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={insertPrimaryStarter}
                    style={{ ...buttonBase, padding: "6px 9px", fontSize: 16 }}
                  >
                    +
                  </button>
                  <select
                    value={primaryAgentMode}
                    onChange={(event) => setPrimaryAgentMode(event.target.value)}
                    style={{
                      ...inputBase,
                      width: "auto",
                      minWidth: 88,
                      background: palette.panelAlt,
                    }}
                  >
                    {SECONDARY_AGENT_OPTIONS.map((item) => (
                      <option key={`primary-agent-${item.value}`} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={primaryDepthMode}
                    onChange={(event) => setPrimaryDepthMode(event.target.value)}
                    style={{
                      ...inputBase,
                      width: "auto",
                      minWidth: 82,
                      background: palette.panelAlt,
                    }}
                  >
                    {SECONDARY_DEPTH_OPTIONS.map((item) => (
                      <option key={`primary-depth-${item.value}`} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {renderChatModelPicker({
                    options: FREE_CHAT_MODELS,
                    selectedValue: primaryChatModel,
                    isOpen: primaryModelMenuOpen,
                    onToggle: () => setPrimaryModelMenuOpen((prev) => !prev),
                    onSelect: handlePrimaryModelSelect,
                    variant: "free",
                    width: isCompact ? 220 : 230,
                  })}
                  <button
                    type="button"
                    onClick={togglePrimaryContextScope}
                    style={{
                      ...buttonBase,
                      background: primaryContextScope === "focused" ? palette.accentSoft : palette.panel,
                      borderColor: primaryContextScope === "focused" ? palette.accent : palette.border,
                      color: primaryContextScope === "focused" ? palette.text : palette.textSoft,
                    }}
                  >
                    Ctx {primaryContextScope === "focused" ? "Focused" : "Workspace"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => sendPrimaryChatMessage()}
                  disabled={!primaryChatInput.trim() || primaryChatLoading || !canUseAiFeatures}
                  style={{
                    ...buttonBase,
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 18,
                    background: `linear-gradient(135deg, ${palette.accent}, #0ea5e9)`,
                    borderColor: "transparent",
                    color: "#ffffff",
                    opacity:
                      !primaryChatInput.trim() || primaryChatLoading || !canUseAiFeatures ? 0.6 : 1,
                    cursor:
                      !primaryChatInput.trim() || primaryChatLoading || !canUseAiFeatures
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  ^
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: palette.codeBg,
                    color: palette.textSoft,
                    fontSize: 11,
                  }}
                >
                  Free Chat
                </span>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: palette.codeBg,
                    color: palette.textSoft,
                    fontSize: 11,
                  }}
                >
                  {primaryContextLabel}
                </span>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: `1px solid ${palette.accent}44`,
                    background: `${palette.accent}16`,
                    color: palette.accent,
                    fontSize: 11,
                  }}
                >
                  {selectedFreeModel.label}
                </span>
              </div>
              <button type="button" onClick={cyclePrimaryApprovalMode} style={buttonBase}>
                {primaryApprovalLabel} v
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderIDEHeader = () => (
    <div
      style={{
        background: palette.titleBar,
        borderBottom: `1px solid ${palette.border}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f56", display: "inline-block" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ffbd2e", display: "inline-block" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#27c93f", display: "inline-block" }} />
          </div>
          <div style={{ 
            fontSize: 13, 
            fontWeight: 500, 
            color: palette.textSoft,
            textAlign: "center",
            flex: 1,
          }}>
            CodeSense IDE — {activeFileData ? getBaseName(activeFileData.name) : "No file open"}
          </div>
          <div style={{ flex: 1 }} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompact ? "1fr" : "1fr auto",
          gap: 10,
          alignItems: "center",
          padding: "6px 12px",
          background: palette.panelAlt,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={launchFilePicker} style={{ ...buttonBase, padding: "4px 10px", minHeight: 22, fontSize: 11 }}>
            + File
          </button>
          <button type="button" onClick={launchFolderPicker} style={{ ...buttonBase, padding: "4px 10px", minHeight: 22, fontSize: 11 }}>
            + Folder
          </button>
          <div style={{ width: 1, height: 18, background: palette.border, margin: "0 6px" }} />
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Anthropic API Key..."
            style={{
              ...inputBase,
              width: isCompact ? "100%" : 180,
              padding: "4px 8px",
              fontSize: 11,
              minHeight: 22,
            }}
          />
          <button type="button" onClick={() => setShowKey((prev) => !prev)} style={{ ...buttonBase, padding: "4px 8px", minHeight: 22, fontSize: 11 }}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: isCompact ? "flex-start" : "flex-end" }}>
          {Object.entries(MODE_CONFIG).slice(0, 4).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 22,
                fontSize: 10,
                background: mode === key ? palette.accent : "transparent",
                borderColor: mode === key ? palette.accent : "transparent",
                color: mode === key ? "#ffffff" : palette.textSoft,
              }}
            >
              {item.label}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: palette.border, margin: "0 4px" }} />
          <button type="button" onClick={() => setShowBottomPanel((prev) => !prev)} style={{ ...buttonBase, padding: "4px 8px", minHeight: 22, fontSize: 10 }}>
            {showBottomPanel ? "▼" : "▲"} Terminal
          </button>
          <button type="button" onClick={() => setShowRightSidebar((prev) => !prev)} style={{ ...buttonBase, padding: "4px 8px", minHeight: 22, fontSize: 10 }}>
            {showRightSidebar ? "▶" : "◀"} AI
          </button>
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            style={{ ...buttonBase, padding: "4px 8px", minHeight: 22, fontSize: 10 }}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderSearchSidebar = () => (
    <div
      style={{
        ...panelStyle,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}
    >
      <div>
        <div style={{ fontWeight: 800 }}>Search Workspace</div>
        <div style={{ color: palette.textSoft, fontSize: 12, marginTop: 4 }}>
          Search across every loaded file like a lightweight IDE grep panel.
        </div>
      </div>
      <input
        value={workspaceSearch}
        onChange={(event) => setWorkspaceSearch(event.target.value)}
        placeholder="Search in files..."
        style={inputBase}
      />
      <div style={{ color: palette.textSoft, fontSize: 12 }}>
        {workspaceSearch.trim() ? `${workspaceMatches.length} matches` : "Enter a term to search the workspace."}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto", minHeight: 0 }}>
        {!workspaceSearch.trim() ? (
          <div
            style={{
              padding: 16,
              borderRadius: 14,
              background: palette.codeBg,
              border: `1px solid ${palette.border}`,
              color: palette.textSoft,
              lineHeight: 1.7,
              fontSize: 12,
            }}
          >
            Search results will appear here. Click any match to jump to that file.
          </div>
        ) : !workspaceMatches.length ? (
          <div
            style={{
              padding: 16,
              borderRadius: 14,
              background: palette.codeBg,
              border: `1px solid ${palette.border}`,
              color: palette.textSoft,
              fontSize: 12,
            }}
          >
            No matches found.
          </div>
        ) : (
          workspaceMatches.map((match, index) => (
            <button
              key={`${match.fileName}-${match.lineNumber}-${index}`}
              type="button"
              onClick={() => {
                revealFilePath(match.fileName);
                setActiveFile(match.fileName);
                setView("editor");
                setActivity("search");
              }}
              style={{
                border: `1px solid ${activeFile === match.fileName ? palette.accent : palette.border}`,
                borderRadius: 14,
                background: activeFile === match.fileName ? palette.accentSoft : palette.codeBg,
                padding: 12,
                textAlign: "left",
                cursor: "pointer",
                color: palette.text,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{match.fileName}</div>
              <div style={{ color: palette.textMuted, fontSize: 11, marginBottom: 6 }}>
                Line {match.lineNumber}
              </div>
              <div style={{ color: palette.textSoft, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {match.line.trim() || "(empty line)"}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  const renderReviewWorkbench = () => (
    <div
      style={{
        ...panelStyle,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}
    >
      <div>
        <div style={{ fontWeight: 800 }}>Review Workbench</div>
        <div style={{ color: palette.textSoft, fontSize: 12, marginTop: 4 }}>
          Drive AI review, bug fixing, and repo health from one panel.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {[
          { label: "Files", value: files.length },
          { label: "Avg Quality", value: analyzedFiles.length ? `${avgQuality}` : "--" },
          { label: "Issues", value: totalIssues },
          { label: "Critical", value: criticalIssues },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              padding: 12,
              borderRadius: 14,
              background: palette.codeBg,
              border: `1px solid ${palette.border}`,
            }}
          >
            <div style={{ color: palette.textSoft, fontSize: 11 }}>{item.label}</div>
            <div style={{ fontWeight: 800, marginTop: 8, fontSize: 18 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          onClick={() => activeFileData && analyzeFile(activeFileData)}
          disabled={!activeFileData || !canUseAiFeatures}
          style={{
            ...buttonBase,
            justifyContent: "center",
            background: `linear-gradient(135deg, ${palette.accent}, #0ea5e9)`,
            borderColor: "transparent",
            opacity: !activeFileData || !canUseAiFeatures ? 0.6 : 1,
            cursor: !activeFileData || !canUseAiFeatures ? "not-allowed" : "pointer",
          }}
        >
          Analyze Active File
        </button>
        <button type="button" onClick={analyzeAll} disabled={!files.length || !canUseAiFeatures} style={{ ...buttonBase, justifyContent: "center", opacity: !files.length || !canUseAiFeatures ? 0.6 : 1 }}>
          Analyze All Files
        </button>
        <button type="button" onClick={applyFixedCodeToEditor} style={{ ...buttonBase, justifyContent: "center" }}>
          Apply AI Fix
        </button>
        <button type="button" onClick={handleExportReport} style={{ ...buttonBase, justifyContent: "center" }}>
          Export HTML Report
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto", minHeight: 0 }}>
        {files.map((file) => {
          const result = results[file.name];
          const score = result?.score;
          return (
            <button
              key={file.name}
              type="button"
              onClick={() => {
                revealFilePath(file.name);
                setActiveFile(file.name);
                setView("editor");
              }}
              style={{
                border: `1px solid ${activeFile === file.name ? palette.accent : palette.border}`,
                borderRadius: 14,
                background: activeFile === file.name ? palette.accentSoft : palette.codeBg,
                padding: 12,
                textAlign: "left",
                cursor: "pointer",
                color: palette.text,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.name}
                  </div>
                  <div style={{ color: palette.textSoft, fontSize: 11, marginTop: 5 }}>
                    {capitalize(file.lang)} | {countLines(file.content)} lines
                  </div>
                </div>
                <div
                  style={{
                    padding: "5px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    border: `1px solid ${score ? `${scoreColor(score)}50` : palette.border}`,
                    color: score ? scoreColor(score) : palette.textMuted,
                    background: score ? `${scoreColor(score)}14` : palette.panelAlt,
                  }}
                >
                  {typeof score === "number" ? score : "Idle"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderGitPanel = () => {
    const allChanges = [
      ...(gitChanges.untracked || []).map((change) => ({ ...change, bucket: "Untracked" })),
      ...(gitChanges.unstaged || []).map((change) => ({ ...change, bucket: "Changes" })),
      ...(gitChanges.staged || []).map((change) => ({ ...change, bucket: "Staged" })),
    ];
    const totalChanges = allChanges.length;

    return (
      <div style={{ ...panelStyle, padding: 12, display: "flex", flexDirection: "column", gap: 12, background: palette.sideBar }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>Source Control</div>
          <span style={{ fontSize: 11, color: palette.textSoft }}>{gitBranch} ↻</span>
        </div>
        
        <div style={{ fontSize: 11, color: palette.textSoft, padding: "8px 0" }}>
          {files.length} files in workspace
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: palette.textSoft, marginTop: 8 }}>
            Changes ({totalChanges})
          </div>
          
          {!totalChanges ? (
            <div
              style={{
                padding: "10px 8px",
                borderRadius: 4,
                background: palette.codeBg,
                color: palette.textMuted,
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              No workspace changes detected. Edit files, add snippets, or load a folder to populate source control.
            </div>
          ) : (
            allChanges.map((change, idx) => (
              <button
                key={`${change.file}-${change.type}-${idx}`}
                type="button"
                onClick={() => {
                  const targetExists = files.some((file) => file.name === change.file);
                  if (targetExists) {
                    revealFilePath(change.file);
                    setActiveFile(change.file);
                    setView("editor");
                  } else {
                    setTransientNotice("info", `${change.file} was deleted from the workspace.`);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 4,
                  background: activeFile === change.file ? palette.selection : palette.codeBg,
                  cursor: "pointer",
                  fontSize: 12,
                  color: palette.text,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    color: change.type === "added" ? "#4ec9b0" : change.type === "deleted" ? "#f14c4c" : "#dcdcaa",
                    fontWeight: 600,
                    minWidth: 10,
                  }}
                >
                  {change.type === "added" ? "A" : change.type === "deleted" ? "D" : "M"}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {change.file}
                </span>
                <span style={{ color: palette.textMuted, fontSize: 10 }}>{change.bucket}</span>
              </button>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              const nextChanges = refreshGitState();
              const nextTotal =
                nextChanges.staged.length + nextChanges.unstaged.length + nextChanges.untracked.length;
              appendOutput("git", `Source control refreshed. ${nextTotal} change${nextTotal === 1 ? "" : "s"} detected.`);
              setTransientNotice("info", `Refreshed source control with ${nextTotal} change${nextTotal === 1 ? "" : "s"}.`);
            }}
            style={{ ...buttonBase, flex: 1, justifyContent: "center", fontSize: 11, padding: "6px 8px" }}
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={commitWorkspaceSnapshot}
            style={{ ...buttonBase, flex: 1, justifyContent: "center", fontSize: 11, padding: "6px 8px", background: palette.accent, borderColor: palette.accent, color: "#fff" }}
          >
            ✓ Commit
          </button>
        </div>

        {gitCommits.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: palette.textSoft }}>Recent Commits</div>
            {gitCommits.slice(0, 4).map((commit) => (
              <div
                key={commit.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 4,
                  background: palette.codeBg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 12, color: palette.text }}>{commit.message}</span>
                <span style={{ fontSize: 10, color: palette.textMuted }}>
                  {formatTimestamp(commit.timestamp)} • {commit.changeCount} change{commit.changeCount === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: palette.textMuted, textAlign: "center", padding: "8px 0" }}>
            No commits yet. Refresh or commit to capture the current workspace state.
          </div>
        )}
      </div>
    );
  };

  const renderWelcomeScreen = () => {
    if (!showWelcome) return null;
    
    return (
      <div
        onClick={() => {
          setShowWelcome(false);
          localStorage.setItem("codesense-welcomed", "true");
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          display: "grid",
          placeItems: "center",
          zIndex: 100,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(700px, calc(100vw - 40px))",
            maxHeight: "80vh",
            overflow: "auto",
            ...panelStyle,
            padding: 32,
            background: palette.panel,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Welcome to CodeSense IDE</div>
          <div style={{ color: palette.textSoft, marginBottom: 24 }}>AI-Powered Code Review & Development Environment</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { icon: "📁", title: "Open Folder", desc: "Open a project folder", action: launchFolderPicker },
              { icon: "📄", title: "Open File", desc: "Open individual files", action: launchFilePicker },
              { icon: "🤖", title: "AI Code Review", desc: "Analyze code with AI", action: () => activeFileData && analyzeFile(activeFileData) },
              { icon: "⚙️", title: "Settings", desc: "Customize your IDE", action: () => setShowSettings(true) },
            ].map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={item.action}
                style={{
                  padding: 20,
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  cursor: "pointer",
                  textAlign: "left",
                  color: palette.text,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 24 }}>{item.icon}</span>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: palette.textSoft }}>{item.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12, color: palette.textMuted, textAlign: "center" }}>
            Press <span style={{ color: palette.accent, fontWeight: 600 }}>Ctrl+Shift+P</span> for command palette • 
            Press <span style={{ color: palette.accent, fontWeight: 600 }}>F1</span> for keyboard shortcuts
          </div>
          
          <div style={{ marginTop: 24, fontSize: 11, color: palette.textMuted, textAlign: "center" }}>
            Click anywhere to close
          </div>
        </div>
      </div>
    );
  };

  const renderWorkbenchSidebar = () => {
    if (activity === "search") return renderSearchSidebar();
    if (activity === "review") return renderReviewWorkbench();
    if (activity === "git") return renderGitPanel();
    return renderSidebar();
  };

  const renderActivityRail = () => {
    const items = [
      {
        id: "explorer",
        icon: "📁",
        label: "Explorer",
        onClick: () => {
          setActivity("explorer");
          setView("editor");
        },
      },
      {
        id: "search",
        icon: "🔍",
        label: "Search",
        onClick: () => {
          setActivity("search");
          setView("editor");
        },
      },
      {
        id: "source",
        icon: "🔀",
        label: "Source Control",
        onClick: () => {
          setActivity("git");
          setView("editor");
        },
      },
      {
        id: "review",
        icon: "🤖",
        label: "AI Review",
        onClick: () => {
          setActivity("review");
          setAssistantTab("review");
          setShowRightSidebar(true);
          setView("editor");
        },
      },
      {
        id: "chat",
        icon: "💬",
        label: "Chat",
        onClick: openMainChat,
      },
      {
        id: "dashboard",
        icon: "📈",
        label: "Dashboard",
        onClick: () => {
          setActivity("review");
          setView("dashboard");
        },
      },
    ];

    return (
      <div
        style={{
          ...panelStyle,
          width: 48,
          minWidth: 48,
          padding: "8px 4px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          background: palette.activityBar,
          border: "none",
        }}
      >
        {items.map((item) => {
          const isActive =
            item.id === "dashboard"
              ? centerView === "dashboard"
              : item.id === "chat"
                ? centerView === "chat"
                : item.id === "review"
                  ? activity === item.id && centerView !== "chat"
                  : activity === item.id;

          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={item.onClick}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                border: "none",
                background: isActive ? `${palette.accent}22` : "transparent",
                color: isActive ? palette.activityActive : palette.activityIcon,
                padding: 0,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
              }}
            >
              {item.icon}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          title="Settings"
          onClick={() => setShowSettings(true)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: palette.activityIcon,
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ⚙️
        </button>
      </div>
    );
  };

  const renderEditorTabs = () => (
    <div
      style={{
        display: "flex",
        gap: 1,
        overflow: "auto",
        padding: "6px 8px 0",
        borderBottom: `1px solid ${palette.border}`,
        background: palette.panelAlt,
      }}
    >
      {openTabs.length ? (
        openTabs.map((tabName) => {
          const file = files.find((item) => item.name === tabName);
          if (!file) return null;
          const isActive = activeFile === tabName;
          const isDirty = isFileDirty(tabName);
          
          const getFileIcon = (lang) => {
            const icons = {
              javascript: "📜",
              typescript: "📘",
              python: "🐍",
              html: "🌐",
              css: "🎨",
              json: "📋",
              md: "📝",
              jsx: "⚛️",
              tsx: "⚛️",
              default: "📄",
            };
            return icons[lang] || icons.default;
          };

          return (
            <div
              key={tabName}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                borderRadius: "6px 6px 0 0",
                padding: "6px 10px",
                border: `1px solid ${isActive ? palette.border : "transparent"}`,
                borderBottom: isActive ? `1px solid ${palette.panel}` : "1px solid transparent",
                background: isActive ? palette.panel : "transparent",
                marginBottom: -1,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveFile(tabName);
                  setView("editor");
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isActive ? palette.text : palette.textSoft,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  padding: 0,
                }}
              >
                <span style={{ fontSize: 12 }}>{getFileIcon(file.lang)}</span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 140,
                  }}
                >
                  {getBaseName(tabName)}
                </span>
                {isDirty ? <span style={{ color: palette.warning, fontSize: 10 }}>●</span> : null}
              </button>
              <button
                type="button"
                onClick={() => closeTab(tabName)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: palette.textMuted,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                }}
              >
                ×
              </button>
            </div>
          );
        })
      ) : (
        <div style={{ color: palette.textMuted, fontSize: 12, padding: "6px 12px" }}>No open editors</div>
      )}
    </div>
  );

  const renderEditorSurface = () => {
    if (centerView === "chat") {
      return <div style={{ minHeight: 0, display: "flex", flex: 1 }}>{renderChat()}</div>;
    }

    if (!activeFileData) {
      return (
        <div
          style={{
            ...panelStyle,
            flex: 1,
            display: "grid",
            placeItems: "center",
            minHeight: 420,
            textAlign: "center",
            padding: 28,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 12 }}>Welcome to CodeSense IDE</div>
            <div style={{ color: palette.textSoft, lineHeight: 1.8 }}>
              Open a folder to browse files, edit code with Monaco Editor, and run AI code review.
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <span style={{ padding: "6px 12px", borderRadius: 6, background: palette.panelAlt, fontSize: 11, color: palette.textSoft }}>
                Ctrl+F: Find
              </span>
              <span style={{ padding: "6px 12px", borderRadius: 6, background: palette.panelAlt, fontSize: 11, color: palette.textSoft }}>
                Ctrl+H: Replace
              </span>
              <span style={{ padding: "6px 12px", borderRadius: 6, background: palette.panelAlt, fontSize: 11, color: palette.textSoft }}>
                Ctrl+Shift+P: Command Palette
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (centerView === "dashboard") {
      return <div style={{ minHeight: 0, display: "flex", flex: 1 }}>{renderDashboard()}</div>;
    }

    if (centerView === "diff") {
      return <div style={{ minHeight: 0, display: "flex", flex: 1 }}>{renderDiffCenter()}</div>;
    }

    const breadcrumbs = normalizeFilePath(activeFileData.name).split("/").filter(Boolean);
    const lines = String(activeFileData.content || "").split("\n");

    return (
      <div
        style={{
          ...panelStyle,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {renderEditorTabs()}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "8px 12px",
            borderBottom: `1px solid ${palette.border}`,
            background: palette.panel,
            fontSize: 12,
          }}
        >
          <div style={{ minWidth: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: palette.textMuted, fontSize: 11 }}>
              {breadcrumbs.slice(0, -1).join(" / ")}
              {breadcrumbs.length > 1 ? " / " : ""}
            </span>
            <span style={{ fontWeight: 600 }}>{getBaseName(activeFileData.name)}</span>
            <span style={{ color: palette.textSoft }}>{capitalize(activeFileData.lang)}</span>
            <span style={{ color: palette.textMuted }}>{lines.length} lines</span>
            {typeof activeResult?.score === "number" ? (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: `${scoreColor(activeResult.score)}22`,
                  color: scoreColor(activeResult.score),
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Score: {activeResult.score}
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => setShowFindReplace(true)} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              🔍 Find
            </button>
            <button type="button" onClick={() => void saveActiveFile()} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              💾 Save
            </button>
            <button type="button" onClick={handleCopyFixedCode} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              📋 Copy
            </button>
            <button type="button" onClick={applyFixedCodeToEditor} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              ✨ Apply Fix
            </button>
          </div>
        </div>

        {showFindReplace && (
          <div style={{
            display: "flex",
            gap: 8,
            padding: "8px 12px",
            borderBottom: `1px solid ${palette.border}`,
            background: palette.panelAlt,
            alignItems: "center",
          }}>
            <input
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Find..."
              style={{ ...inputBase, width: 200, padding: "4px 8px", fontSize: 12 }}
            />
            <button type="button" onClick={() => {
              if (monacoEditorRef.current && findQuery) {
                monacoEditorRef.current.getAction("actions.find")?.run();
              }
            }} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              Find Next
            </button>
            <input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="Replace..."
              style={{ ...inputBase, width: 200, padding: "4px 8px", fontSize: 12 }}
            />
            <button type="button" onClick={() => {
              if (monacoEditorRef.current && findQuery) {
                monacoEditorRef.current.trigger("keyboard", "editor.action.replaceOne", {
                  pattern: findQuery,
                  replaceString: replaceQuery,
                });
              }
            }} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              Replace
            </button>
            <button type="button" onClick={() => setShowFindReplace(false)} style={{ ...buttonBase, padding: "4px 8px", fontSize: 11 }}>
              ✕
            </button>
          </div>
        )}

        <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
          {!monacoReady ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", color: palette.textSoft }}>
              Loading Monaco Editor...
            </div>
          ) : (
            <div ref={editorContainerRef} style={{ flex: 1, minHeight: 0 }} />
          )}
        </div>
      </div>
    );
  };

  const renderPrimaryChatSidebar = () => {
    const quickPrompts = [
      "Explain this code",
      "Find likely bugs",
      "Suggest tests",
      "Improve performance",
    ];
    const selectedFreeModel = getChatModelOption(FREE_CHAT_MODELS, primaryChatModel);

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
          flex: 1,
          overflow: "auto",
          paddingRight: 2,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {quickPrompts.map((prompt) => (
            <button
              key={`sidebar-free-${prompt}`}
              type="button"
              onClick={() => sendPrimaryChatMessage(prompt)}
              style={buttonBase}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div style={{ ...sectionLabelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Chat Session</span>
          <span>{primaryChatMsgs.length} msg</span>
        </div>

        <div
          style={{
            flex: "1 1 0",
            minHeight: 140,
            maxHeight: "34vh",
            overflow: "auto",
            borderRadius: 16,
            border: `1px solid ${palette.border}`,
            background: palette.codeBg,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {!primaryChatMsgs.length ? (
            <div style={{ color: palette.textSoft, lineHeight: 1.8, minHeight: 116 }}>
              Regular Chat stays separate from Toggle Secondary. Use this tab for normal free chat help.
            </div>
          ) : (
            primaryChatMsgs.map((msg, index) => (
              <div
                key={`primary-side-msg-${index}`}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  borderRadius: 16,
                  border: `1px solid ${msg.role === "user" ? `${palette.accent}55` : palette.border}`,
                  background: msg.role === "user" ? palette.accentSoft : palette.panel,
                  padding: 12,
                }}
              >
                {msg.role === "assistant" ? (
                  <div style={{ color: palette.textSoft, fontSize: 11, marginBottom: 6 }}>Free Chat</div>
                ) : null}
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{msg.content}</div>
              </div>
            ))
          )}
          {primaryChatLoading ? (
            <div style={{ color: palette.textSoft, border: `1px solid ${palette.border}`, borderRadius: 14, padding: 12 }}>
              Free model thinking...
            </div>
          ) : null}
        </div>

        <div
          style={{
            border: `1px solid ${palette.border}`,
            background: palette.panelAlt,
            borderRadius: 14,
            overflow: "visible",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          <textarea
            value={primaryChatInput}
            onChange={(event) => setPrimaryChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendPrimaryChatMessage();
              }
            }}
            placeholder="Ask in normal chat..."
            style={{
              width: "100%",
              minHeight: 86,
              resize: "vertical",
              border: "none",
              outline: "none",
              background: "transparent",
              color: palette.text,
              padding: "14px 14px 10px",
              fontFamily: UI_FONT,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          />
          <div
            style={{
              borderTop: `1px solid ${palette.border}`,
              padding: "10px 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              {renderChatModelPicker({
                options: FREE_CHAT_MODELS,
                selectedValue: primaryChatModel,
                isOpen: primaryModelMenuOpen,
                onToggle: () => setPrimaryModelMenuOpen((prev) => !prev),
                onSelect: handlePrimaryModelSelect,
                variant: "free",
                width: 190,
              })}
              <span
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  color: palette.textSoft,
                  fontSize: 11,
                }}
              >
                {selectedFreeModel.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => sendPrimaryChatMessage()}
              disabled={!primaryChatInput.trim() || primaryChatLoading || !canUseAiFeatures}
              style={{
                ...buttonBase,
                justifyContent: "center",
                width: 34,
                height: 34,
                padding: 0,
                fontSize: 18,
                background: `linear-gradient(135deg, ${palette.accent}, #0ea5e9)`,
                borderColor: "transparent",
                color: "#ffffff",
                opacity: !primaryChatInput.trim() || primaryChatLoading || !canUseAiFeatures ? 0.6 : 1,
                cursor: !primaryChatInput.trim() || primaryChatLoading || !canUseAiFeatures ? "not-allowed" : "pointer",
              }}
            >
              ^
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderChatSidebar = () => {
    const quickPrompts = [
      "Explain this code",
      "Find all bugs",
      "How to optimize?",
      "Write unit tests",
      "What patterns are used?",
      "Add error handling",
    ];
    const secondaryPlaceholder =
      secondaryAgentMode === "review"
        ? "Describe what to review"
        : secondaryAgentMode === "fix"
          ? "Describe the bug or fix you want"
          : secondaryAgentMode === "test"
            ? "Describe what to test"
            : "Describe what to build";
    const approvalLabel =
      SECONDARY_APPROVAL_OPTIONS.find((item) => item.value === secondaryApprovalMode)?.label ||
      "Default Approvals";
    const premiumModel = getChatModelOption(PREMIUM_CHAT_MODELS, secondaryChatModel);
    const runtimeLabel = hasApiKey ? "Premium Ready" : "Local Fallback";
    const contextLabel =
      secondaryContextScope === "workspace" ? "Workspace Context" : "Focused Context";
    const emptySecondaryChat = !chatMsgs.length && !chatLoading;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
          flex: 1,
          overflow: "auto",
          paddingRight: 2,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendSecondaryChatMessage(prompt)}
              style={buttonBase}
            >
              {prompt}
            </button>
          ))}
        </div>
        <div style={{ ...sectionLabelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Session</span>
          <span>{chatMsgs.length} msg</span>
        </div>
        <div
          ref={chatScrollRef}
          style={{
            flex: "1 1 0",
            minHeight: emptySecondaryChat ? 140 : 160,
            maxHeight: "34vh",
            overflow: "auto",
            borderRadius: 16,
            border: `1px solid ${palette.border}`,
            background: palette.codeBg,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {!chatMsgs.length ? (
            <div style={{ color: palette.textSoft, lineHeight: 1.8, minHeight: 116 }}>
              Start a conversation about the active file. The assistant already knows the active code and latest review summary, and the builder bar below lets you steer the reply style.
            </div>
          ) : (
            chatMsgs.map((msg, index) => (
              <div
                key={`side-msg-${index}`}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  borderRadius: 16,
                  border: `1px solid ${msg.role === "user" ? `${palette.accent}55` : palette.border}`,
                  background: msg.role === "user" ? palette.accentSoft : palette.panel,
                  padding: 12,
                }}
              >
                {msg.role === "assistant" ? (
                  <div style={{ color: palette.textSoft, fontSize: 11, marginBottom: 6 }}>Premium Secondary</div>
                ) : null}
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{msg.content}</div>
              </div>
            ))
          )}
          {chatLoading ? (
            <div style={{ color: palette.textSoft, border: `1px solid ${palette.border}`, borderRadius: 14, padding: 12 }}>
              AI Thinking...
            </div>
          ) : null}
        </div>
        <div
          style={{
            border: `1px solid ${palette.border}`,
            background: palette.panelAlt,
            borderRadius: 14,
            overflow: "visible",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          <textarea
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendSecondaryChatMessage();
              }
            }}
            placeholder={secondaryPlaceholder}
            style={{
              width: "100%",
              minHeight: 86,
              resize: "vertical",
              border: "none",
              outline: "none",
              background: "transparent",
              color: palette.text,
              padding: "14px 14px 10px",
              fontFamily: UI_FONT,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          />
          <div
            style={{
              borderTop: `1px solid ${palette.border}`,
              padding: "10px 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <button type="button" onClick={insertSecondaryStarter} style={{ ...buttonBase, padding: "6px 9px", fontSize: 16 }}>
                +
              </button>
              <select
                value={secondaryAgentMode}
                onChange={(event) => setSecondaryAgentMode(event.target.value)}
                style={{
                  ...inputBase,
                  width: "auto",
                  minWidth: 88,
                  background: palette.panel,
                }}
              >
                {SECONDARY_AGENT_OPTIONS.map((item) => (
                  <option key={`secondary-agent-${item.value}`} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                value={secondaryDepthMode}
                onChange={(event) => setSecondaryDepthMode(event.target.value)}
                style={{
                  ...inputBase,
                  width: "auto",
                  minWidth: 82,
                  background: palette.panel,
                }}
              >
                {SECONDARY_DEPTH_OPTIONS.map((item) => (
                  <option key={`secondary-depth-${item.value}`} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              {renderChatModelPicker({
                options: PREMIUM_CHAT_MODELS,
                selectedValue: secondaryChatModel,
                isOpen: secondaryModelMenuOpen,
                onToggle: () => setSecondaryModelMenuOpen((prev) => !prev),
                onSelect: handleSecondaryModelSelect,
                variant: "premium",
                width: 210,
              })}
              <button
                type="button"
                onClick={toggleSecondaryContextScope}
                style={{
                  ...buttonBase,
                  background: secondaryContextScope === "focused" ? palette.accentSoft : palette.panel,
                  borderColor: secondaryContextScope === "focused" ? palette.accent : palette.border,
                  color: secondaryContextScope === "focused" ? palette.text : palette.textSoft,
                }}
              >
                Ctx {secondaryContextScope === "focused" ? "Focused" : "Workspace"}
              </button>
            </div>
            <button
              type="button"
              onClick={sendSecondaryChatMessage}
              disabled={!chatInput.trim() || chatLoading || !canUseAiFeatures}
              style={{
                ...buttonBase,
                justifyContent: "center",
                width: 34,
                height: 34,
                padding: 0,
                fontSize: 18,
                background: `linear-gradient(135deg, ${palette.accent}, #0ea5e9)`,
                borderColor: "transparent",
                color: "#ffffff",
                opacity: !chatInput.trim() || chatLoading || !canUseAiFeatures ? 0.6 : 1,
                cursor: !chatInput.trim() || chatLoading || !canUseAiFeatures ? "not-allowed" : "pointer",
              }}
            >
              ↑
            </button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                background: palette.codeBg,
                color: palette.textSoft,
                fontSize: 11,
              }}
            >
              {runtimeLabel}
            </span>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid #c084fc45`,
                background: "rgba(192,132,252,0.12)",
                color: "#d8b4fe",
                fontSize: 11,
              }}
            >
              {premiumModel.label}
            </span>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                background: palette.codeBg,
                color: palette.textSoft,
                fontSize: 11,
              }}
            >
              {contextLabel}
            </span>
          </div>
          <button type="button" onClick={cycleSecondaryApprovalMode} style={buttonBase}>
            {approvalLabel} v
          </button>
        </div>
      </div>
    );
  };

  const renderContextSidebar = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 16,
          border: `1px solid ${palette.border}`,
          background: palette.codeBg,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Context</div>
        <div style={{ color: palette.textSoft, fontSize: 12, lineHeight: 1.8 }}>
          File: {activeFileData?.name || "No file selected"}
          <br />
          Language: {activeFileData ? capitalize(activeFileData.lang) : "--"}
          <br />
          Lines: {activeFileData ? countLines(activeFileData.content) : 0}
          <br />
          Cursor: Ln {cursorPos.line}, Col {cursorPos.column}
          <br />
          Tabs Open: {openTabs.length}
        </div>
      </div>
      <div
        style={{
          padding: 14,
          borderRadius: 16,
          border: `1px solid ${palette.border}`,
          background: palette.codeBg,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Latest Analysis</div>
        {activeResult && !activeResult.error ? (
          <div style={{ color: palette.textSoft, fontSize: 12, lineHeight: 1.8 }}>
            Mode: {MODE_CONFIG[activeResult.mode]?.label || capitalize(activeResult.mode)}
            <br />
            Score: {activeResult.score}
            <br />
            Grade: {activeResult.grade}
            <br />
            Timestamp: {formatTimestamp(activeResult.timestamp)}
          </div>
        ) : (
          <div style={{ color: palette.textSoft, fontSize: 12 }}>No successful analysis yet.</div>
        )}
      </div>
    </div>
  );

  const renderCodeSidebar = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, flex: 1 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 16,
          border: `1px solid ${palette.border}`,
          background: palette.codeBg,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Source Code</div>
        <div style={{ color: palette.textSoft, fontSize: 12, lineHeight: 1.8 }}>
          {activeFileData ? activeFileData.name : "No file selected"}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 280,
          overflow: "auto",
          borderRadius: 16,
          border: `1px solid ${palette.border}`,
          background: palette.codeBg,
          padding: 14,
        }}
      >
        {activeFileData ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: EDITOR_FONT,
              fontSize: 12,
              lineHeight: 1.65,
              color: palette.text,
            }}
          >
            {String(activeFileData.content || "")}
          </pre>
        ) : (
          <div style={{ color: palette.textSoft, fontSize: 12, lineHeight: 1.8 }}>
            Open a file from the explorer to show its source code here.
          </div>
        )}
      </div>
    </div>
  );

  const renderAssistantSidebar = () => (
    <div
      style={{
        ...panelStyle,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800 }}>AI Workspace</div>
          <div style={{ color: palette.textSoft, fontSize: 12, marginTop: 4 }}>
            {activeFileData ? getBaseName(activeFileData.name) : "No active file"}
          </div>
        </div>
        <button type="button" onClick={() => setShowRightSidebar(false)} style={buttonBase}>
          Hide
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { id: "review", label: "Review" },
          { id: "chat", label: "Chat" },
          { id: "context", label: "Context" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAssistantTab(tab.id)}
            style={{
              ...buttonBase,
              flex: 1,
              justifyContent: "center",
              background: assistantTab === tab.id ? palette.accentSoft : palette.panelAlt,
              borderColor: assistantTab === tab.id ? palette.accent : palette.border,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>
        {assistantTab === "review"
          ? renderResultsPanel()
          : assistantTab === "secondary"
            ? renderChatSidebar()
            : assistantTab === "chat"
              ? renderPrimaryChatSidebar()
            : renderContextSidebar()}
      </div>
    </div>
  );

  const renderBottomDock = () => {
    if (!showBottomPanel) return null;

    return (
      <div
        style={{
          ...panelStyle,
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 200,
          maxHeight: 280,
          background: palette.panel,
          borderTop: `1px solid ${palette.border}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "problems", label: `Problems ${activeResult?.issues?.length ? `(${activeResult.issues.length})` : ""}` },
              { id: "output", label: `Output ${outputLogs.length ? `(${outputLogs.length})` : ""}` },
              { id: "terminal", label: "Terminal" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBottomTab(tab.id)}
                style={{
                  ...buttonBase,
                  padding: "4px 12px",
                  fontSize: 11,
                  background: bottomTab === tab.id ? palette.panelAlt : "transparent",
                  borderColor: bottomTab === tab.id ? palette.accent : "transparent",
                  borderBottom: bottomTab === tab.id ? "none" : "1px solid transparent",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowBottomPanel(false)} style={{ ...buttonBase, padding: "2px 8px", fontSize: 11 }}>
            ▼
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            borderRadius: "0 6px 6px 6px",
            border: `1px solid ${palette.border}`,
            background: palette.codeBg,
            padding: 8,
          }}
        >
          {bottomTab === "problems" ? (
            activeResult?.issues?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {activeResult.issues.slice(0, 20).map((issue) => (
                  <button
                    key={`problem-${issue.id}`}
                    type="button"
                    onClick={() => {
                      setShowRightSidebar(true);
                      setAssistantTab("review");
                      setRightTab("issues");
                    }}
                    style={{
                      border: "none",
                      borderRadius: 4,
                      background: "transparent",
                      padding: "4px 8px",
                      textAlign: "left",
                      color: palette.text,
                      cursor: "pointer",
                      fontSize: 12,
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: SEV_COLOR[issue.severity], minWidth: 50 }}>{issue.severity.toUpperCase()}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.title}</span>
                    <span style={{ color: palette.textMuted }}>Ln {issue.line ?? "-"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ color: palette.textMuted, fontSize: 12 }}>No problems detected.</div>
            )
          ) : null}

          {bottomTab === "output" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontFamily: "monospace" }}>
              {outputLogs.slice(-50).map((item) => (
                <div key={item.id}>
                  <span style={{ color: palette.textMuted, marginRight: 8 }}>{new Date(item.timestamp).toLocaleTimeString()}</span>
                  <span style={{ 
                    color: item.kind === "error" ? "#f44336" : item.kind === "analysis" ? "#2196f3" : palette.textSoft,
                    marginRight: 8,
                  }}>[{item.kind.toUpperCase()}]</span>
                  <span style={{ color: palette.text }}>{item.text}</span>
                </div>
              ))}
            </div>
          ) : null}

          {bottomTab === "terminal" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0, height: "100%" }}>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", fontSize: 12, fontFamily: "monospace" }}>
                {terminalLines.map((line) => (
                  <div key={line.id} style={{ color: line.text.startsWith(">") ? palette.accent : palette.textSoft }}>
                    {line.text}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: palette.accent }}>$</span>
                <input
                  value={terminalInput}
                  onChange={(event) => setTerminalInput(event.target.value)}
                  onKeyDown={async (event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const value = terminalInput;
                      setTerminalInput("");
                      await runTerminalCommand(value);
                    }
                  }}
                  placeholder="Type command..."
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    color: palette.text,
                    fontSize: 12,
                    fontFamily: "monospace",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderStatusBar = () => (
    <div
      style={{
        height: 24,
        background: palette.statusBar,
        padding: "0 12px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        fontSize: 12,
        color: "#ffffff",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", opacity: 0.9 }} onClick={() => setActivity("explorer")}>
          {activeFileData ? "📁 " + getBaseName(activeFileData.name) : "No file open"}
        </span>
        {activeFileData && (
          <>
            <span style={{ opacity: 0.6 }}>|</span>
            <span style={{ opacity: 0.9, cursor: "pointer" }} onClick={() => setShowBottomPanel(true)}>
              {capitalize(activeFileData.lang)}
            </span>
          </>
        )}
        <span style={{ opacity: 0.6 }}>|</span>
        <span style={{ display: "flex", gap: 4, opacity: 0.9 }}>
          Ln {cursorPos.line}, Col {cursorPos.column}
        </span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span style={{ opacity: 0.9, cursor: "pointer" }} onClick={() => setShowFindReplace(true)}>
          UTF-8
        </span>
        {editorSettings.wordWrap === "on" && (
          <>
            <span style={{ opacity: 0.6 }}>|</span>
            <span style={{ opacity: 0.9 }}>-wrap</span>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {debugMode && (
          <>
            <span style={{ background: "#f44336", padding: "1px 6px", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>
              DEBUG
            </span>
            <span style={{ opacity: 0.6 }}>|</span>
          </>
        )}
        {autoSave && (
          <>
            <span style={{ background: "#4caf50", padding: "1px 6px", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>
              AutoSave
            </span>
            <span style={{ opacity: 0.6 }}>|</span>
          </>
        )}
        <span style={{ opacity: 0.9, cursor: "pointer" }} onClick={() => setActivity("git")}>
          🔀 {gitBranch}
        </span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span style={{ opacity: 0.9, cursor: "pointer" }} onClick={() => setShowSettings(true)}>
          {MODE_CONFIG[mode]?.label}
        </span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, opacity: 0.9, cursor: "pointer" }} onClick={() => setShowRightSidebar(true)}>
          {hasApiKey ? "Cloud AI" : "Local AI"}
        </span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span style={{ opacity: 0.9 }}>{centerView === "dashboard" ? "Dashboard" : centerView === "diff" ? "Diff" : "Editor"}</span>
        <span style={{ opacity: 0.6 }}>|</span>
        <span style={{ opacity: 0.9, cursor: "pointer" }} onClick={() => setZoom((z) => Math.min(z + 10, 200))}>
          {zoom}%
        </span>
        {activeResult && !activeResult.error && (
          <>
            <span style={{ opacity: 0.6 }}>|</span>
            <span style={{ 
              background: activeResult.score >= 70 ? "#4caf50" : activeResult.score >= 50 ? "#ff9800" : "#f44336",
              padding: "1px 6px",
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }} onClick={() => setView("diff")}>
              Score: {activeResult.score}
            </span>
          </>
        )}
      </div>
    </div>
  );

  const renderCommandPalette = () => {
    if (!commandPaletteOpen) return null;

    const items = [
      {
        id: "open-files",
        label: "Open Files",
        description: "Select one or more local files",
        action: launchFilePicker,
      },
      {
        id: "open-folder",
        label: "Open Folder",
        description: "Load a folder into the explorer",
        action: launchFolderPicker,
      },
      {
        id: "open-extensions",
        label: "Open Extensions",
        description: "Browse and manage workspace extensions",
        action: openExtensionsPanel,
      },
      {
        id: "analyze-active",
        label: "Analyze Active File",
        description: activeFileData ? activeFileData.name : "No active file selected",
        action: () => activeFileData && analyzeFile(activeFileData),
      },
      {
        id: "analyze-all",
        label: "Analyze All Files",
        description: `${files.length} files in workspace`,
        action: analyzeAll,
      },
      {
        id: "show-diff",
        label: "Open Diff View",
        description: "Compare current code against AI fix",
        action: () => setView("diff"),
      },
      {
        id: "show-dashboard",
        label: "Open Dashboard",
        description: "Show repository health overview",
        action: () => setView("dashboard"),
      },
      {
        id: "focus-chat",
        label: "Focus AI Chat",
        description: "Open the main free chat workspace",
        action: openMainChat,
      },
      {
        id: "apply-fix",
        label: "Apply AI Fix",
        description: "Replace editor content with the fixed code",
        action: applyFixedCodeToEditor,
      },
      {
        id: "save-file",
        label: "Save Active File",
        description: activeFileData ? `Write ${getBaseName(activeFileData.name)} back to disk` : "No active file selected",
        action: saveActiveFile,
      },
      {
        id: "save-all",
        label: "Save All Files",
        description: "Write every dirty file back to disk",
        action: saveAllFiles,
      },
      {
        id: "download-file",
        label: "Export Active File",
        description: "Download the current editor buffer",
        action: downloadActiveFile,
      },
      {
        id: "sync-workspace",
        label: "Save Workspace To Server",
        description: workspaceId ? "Update the current Mongo-backed workspace" : "Create a new workspace on the server",
        action: async () => {
          const workspace = await syncWorkspaceToServer();
          if (workspace?._id) {
            setTransientNotice("success", `Workspace saved to server: ${workspace.name || "Workspace"}.`);
          }
        },
      },
      {
        id: "toggle-theme",
        label: theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme",
        description: "Toggle the IDE theme",
        action: () => setTheme((prev) => (prev === "dark" ? "light" : "dark")),
      },
      ...files.map((file) => ({
        id: `open-${file.name}`,
        label: `Open ${file.name}`,
        description: `${capitalize(file.lang)} file`,
        action: () => {
          revealFilePath(file.name);
          setActiveFile(file.name);
          setView("editor");
        },
      })),
    ];

    const filtered = items.filter((item) => {
      const haystack = `${item.label} ${item.description}`.toLowerCase();
      return commandQuery.trim() ? haystack.includes(commandQuery.trim().toLowerCase()) : true;
    });

    return (
      <div
        onClick={() => setCommandPaletteOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2,6,23,0.58)",
          display: "grid",
          placeItems: "start center",
          paddingTop: 100,
          zIndex: 50,
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(760px, calc(100vw - 40px))",
            ...panelStyle,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            ref={commandInputRef}
            value={commandQuery}
            onChange={(event) => setCommandQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCommandPaletteOpen(false);
                return;
              }
              if (event.key === "Enter" && filtered[0]) {
                filtered[0].action();
                setCommandPaletteOpen(false);
                setCommandQuery("");
              }
            }}
            placeholder="Type a command or file name..."
            style={{
              ...inputBase,
              fontSize: 14,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflow: "auto" }}>
            {filtered.length ? (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.action();
                    setCommandPaletteOpen(false);
                    setCommandQuery("");
                  }}
                  style={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: 14,
                    background: palette.codeBg,
                    padding: 12,
                    textAlign: "left",
                    color: palette.text,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{item.label}</div>
                  <div style={{ color: palette.textSoft, fontSize: 12, marginTop: 5 }}>{item.description}</div>
                </button>
              ))
            ) : (
              <div style={{ color: palette.textSoft, padding: 12 }}>No command matches your search.</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSettingsModal = () => {
    if (!showSettings) return null;

    const settingsGroups = [
      {
        title: "Editor",
        settings: [
          { key: "fontSize", label: "Font Size", type: "number", min: 10, max: 24, default: 14 },
          { key: "tabSize", label: "Tab Size", type: "select", options: [2, 4, 8], default: 2 },
          { key: "wordWrap", label: "Word Wrap", type: "select", options: ["on", "off", "wordWrapColumn"], default: "on" },
          { key: "lineNumbers", label: "Line Numbers", type: "boolean", default: true },
          { key: "folding", label: "Code Folding", type: "boolean", default: true },
          { key: "autoIndent", label: "Auto Indent", type: "boolean", default: true },
          { key: "bracketPairColorization", label: "Bracket Pair Colorization", type: "boolean", default: true },
        ],
      },
      {
        title: "Auto Save & Zoom",
        settings: [
          { key: "autoSave", label: "Auto Save", type: "boolean", current: autoSave, action: setAutoSave },
          { key: "zoom", label: "Zoom Level", type: "zoom", current: zoom, action: setZoom },
        ],
      },
      {
        title: "Theme",
        settings: [
          { key: "theme", label: "Theme", type: "select", options: ["dark", "light"], current: theme, action: setTheme },
        ],
      },
    ];

    return (
      <div
        onClick={() => setShowSettings(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2,6,23,0.68)",
          display: "grid",
          placeItems: "center",
          zIndex: 60,
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(600px, calc(100vw - 40px))",
            maxHeight: "80vh",
            ...panelStyle,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${palette.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>⚙️ Settings</div>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              style={{
                border: "none",
                background: "transparent",
                color: palette.textSoft,
                cursor: "pointer",
                fontSize: 18,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
            {settingsGroups.map((group) => (
              <div key={group.title}>
                <div style={{ fontSize: 12, fontWeight: 600, color: palette.textSoft, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {group.title}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.settings.map((setting) => (
                    <div key={setting.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: palette.codeBg, borderRadius: 8 }}>
                      <span style={{ fontSize: 13 }}>{setting.label}</span>
                      {setting.type === "boolean" && setting.key === "autoSave" ? (
                        <button
                          type="button"
                          onClick={() => setting.action(!setting.current)}
                          style={{
                            width: 44,
                            height: 24,
                            borderRadius: 12,
                            border: "none",
                            background: setting.current ? palette.accent : palette.border,
                            cursor: "pointer",
                            position: "relative",
                          }}
                        >
                          <div style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: "#fff",
                            position: "absolute",
                            top: 3,
                            left: setting.current ? 21 : 3,
                            transition: "left 0.2s",
                          }} />
                        </button>
                      ) : setting.type === "boolean" ? (
                        <button
                          type="button"
                          onClick={() => setEditorSettings((prev) => ({ ...prev, [setting.key]: !prev[setting.key] }))}
                          style={{
                            width: 44,
                            height: 24,
                            borderRadius: 12,
                            border: "none",
                            background: editorSettings[setting.key] ? palette.accent : palette.border,
                            cursor: "pointer",
                            position: "relative",
                          }}
                        >
                          <div style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: "#fff",
                            position: "absolute",
                            top: 3,
                            left: editorSettings[setting.key] ? 21 : 3,
                            transition: "left 0.2s",
                          }} />
                        </button>
                      ) : setting.type === "number" ? (
                          <input
                            type="number"
                            value={editorSettings[setting.key] || setting.default}
                            onChange={(e) =>
                              setEditorSettings((prev) => ({
                                ...prev,
                                [setting.key]: clampNumber(
                                  e.target.value,
                                  setting.min ?? 0,
                                  setting.max ?? 999,
                                  setting.default
                                ),
                              }))
                            }
                            min={setting.min}
                            max={setting.max}
                            style={{ width: 60, padding: "4px 8px", border: `1px solid ${palette.border}`, borderRadius: 4, background: palette.inputBg, color: palette.text }}
                          />
                        ) : setting.type === "zoom" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => setting.action(Math.max(50, setting.current - 10))}
                              style={{ padding: "4px 8px", border: `1px solid ${palette.border}`, borderRadius: 4, background: palette.panelAlt, cursor: "pointer", color: palette.text }}
                            >
                              -
                            </button>
                            <span style={{ minWidth: 40, textAlign: "center" }}>{setting.current}%</span>
                            <button
                              type="button"
                              onClick={() => setting.action(Math.min(200, setting.current + 10))}
                              style={{ padding: "4px 8px", border: `1px solid ${palette.border}`, borderRadius: 4, background: palette.panelAlt, cursor: "pointer", color: palette.text }}
                            >
                              +
                            </button>
                          </div>
                        ) : setting.type === "select" && setting.key === "theme" ? (
                        <select
                          value={theme}
                          onChange={(e) => setting.action(e.target.value)}
                          style={{ padding: "4px 8px", border: `1px solid ${palette.border}`, borderRadius: 4, background: palette.inputBg, color: palette.text }}
                        >
                          {setting.options.map((opt) => (
                            <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={editorSettings[setting.key] || setting.default}
                          onChange={(e) =>
                            setEditorSettings((prev) => ({
                              ...prev,
                              [setting.key]:
                                setting.key === "tabSize" ? Number(e.target.value) : e.target.value,
                            }))
                          }
                          style={{ padding: "4px 8px", border: `1px solid ${palette.border}`, borderRadius: 4, background: palette.inputBg, color: palette.text }}
                        >
                          {setting.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: palette.textSoft, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Keyboard Shortcuts
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["Ctrl+Enter", "Analyze Code"],
                  ["Ctrl+D", "Toggle Diff View"],
                  ["Ctrl+Shift+D", "Apply AI Fix"],
                  ["Ctrl+F", "Find"],
                  ["Ctrl+H", "Find & Replace"],
                  ["Ctrl+K", "Open Chat"],
                  ["Ctrl+P", "Quick Open"],
                  ["Ctrl+Shift+P", "Command Palette"],
                  ["Ctrl+,", "Settings"],
                  ["Ctrl+S", "Save File"],
                  ["Ctrl+Shift+S", "Save All"],
                  ["Ctrl+B", "Toggle Terminal"],
                  ["Ctrl+\\", "Toggle Sidebar"],
                  ["Esc", "Close Panels"],
                ].map(([key, action]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: palette.codeBg, borderRadius: 6, fontSize: 12 }}>
                    <span style={{ fontFamily: "monospace", color: palette.accent }}>{key}</span>
                    <span style={{ color: palette.textSoft }}>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const sectionLabelStyle = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: palette.textMuted,
  };

  const renderExplorerNodeV2 = (node, depth = 0) => {
    if (node.type === "folder") {
      const isCollapsed = !!collapsedFolders[node.path];
      const safeActiveFile = String(activeFile || "");
      const isActiveBranch =
        safeActiveFile === node.path || safeActiveFile.startsWith(`${node.path}/`);

      return (
        <div key={`v2-${node.path}`} style={{ display: "flex", flexDirection: "column" }}>
          <button
            type="button"
            onClick={() => toggleFolder(node.path)}
            style={{
              border: "none",
              background: isActiveBranch ? palette.selection : "transparent",
              color: isActiveBranch ? palette.text : palette.textSoft,
              padding: "4px 8px",
              paddingLeft: 8 + depth * 14,
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontFamily: UI_FONT,
              fontSize: 12,
              minHeight: 24,
              width: "100%",
            }}
          >
            <span style={{ width: 8, color: palette.textMuted, fontSize: 10 }}>
              {isCollapsed ? ">" : "v"}
            </span>
            <span
              className="codesense-mono"
              style={{
                width: 22,
                minWidth: 22,
                fontSize: 10,
                color: isActiveBranch ? palette.text : palette.textMuted,
              }}
            >
              DIR
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
              title={node.path}
            >
              {node.name}
            </span>
          </button>
          {!isCollapsed ? node.children.map((child) => renderExplorerNodeV2(child, depth + 1)) : null}
        </div>
      );
    }

    const file = node.file;
    const result = results[file.name];
    const itemLoading = !!loading[file.name];
    const isActive = activeFile === file.name;
    const fileIcon = String(getLanguageIcon(file.lang || detectLanguage(file.name)) || "FILE")
      .toUpperCase()
      .slice(0, 4);

    return (
      <button
        key={`v2-${node.path}`}
        type="button"
        onClick={() => openFileInEditor(file.name)}
        style={{
          border: "none",
          background: isActive ? palette.selection : "transparent",
          color: isActive ? palette.text : palette.textSoft,
          padding: "4px 8px",
          paddingLeft: 22 + depth * 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          cursor: "pointer",
          fontFamily: UI_FONT,
          fontSize: 12,
          width: "100%",
          minHeight: 24,
          minWidth: 0,
        }}
      >
        <span
          className="codesense-mono"
          style={{
            width: 22,
            minWidth: 22,
            fontSize: 10,
            color: isActive ? palette.text : palette.textMuted,
          }}
        >
          {fileIcon}
        </span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={file.name}
        >
          {getBaseName(file.name)}
        </span>
        {itemLoading ? (
          <span className="codesense-mono" style={{ fontSize: 10, color: palette.accent }}>
            ...
          </span>
        ) : typeof result?.score === "number" && !result?.error ? (
          <span className="codesense-mono" style={{ fontSize: 10, color: scoreColor(result.score) }}>
            {result.score}
          </span>
        ) : result?.error ? (
          <span className="codesense-mono" style={{ fontSize: 10, color: palette.danger }}>
            ERR
          </span>
        ) : null}
      </button>
    );
  };

  const renderSidebarV2 = () => (
    <div
      style={{
        background: palette.sideBar,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        width: "100%",
      }}
    >
      <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${palette.border}` }}>
        <div style={sectionLabelStyle}>Explorer</div>
        <div style={{ marginTop: 4, fontSize: 12, color: palette.textSoft }}>{workspaceLabel}</div>
      </div>

      <div style={{ padding: "8px 12px", display: "flex", gap: 8 }}>
        <button type="button" onClick={launchFilePicker} style={{ ...buttonBase, flex: 1, justifyContent: "center" }}>
          Open File
        </button>
        <button
          type="button"
          onClick={launchFolderPicker}
          style={{
            ...buttonBase,
            flex: 1,
            justifyContent: "center",
            background: palette.accentSoft,
            borderColor: palette.accent,
            color: palette.text,
          }}
        >
          Open Folder
        </button>
      </div>

      <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0, flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionLabelStyle}>Open Editors</div>
          {!openTabs.length ? (
            <div style={{ color: palette.textMuted, fontSize: 12 }}>No open editors</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {openTabs.map((tabName) => {
                const file = files.find((item) => item.name === tabName);
                if (!file) return null;
                const isActive = activeFile === tabName;
                const isDirty = isFileDirty(tabName);
                return (
                  <div
                    key={`open-editor-${tabName}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: isActive ? palette.selection : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFile(tabName);
                        setView("editor");
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: isActive ? palette.text : palette.textSoft,
                        cursor: "pointer",
                        padding: "4px 8px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                        flex: 1,
                        textAlign: "left",
                        fontSize: 12,
                      }}
                    >
                      <span className="codesense-mono" style={{ width: 22, color: isActive ? palette.text : palette.textMuted, fontSize: 10 }}>
                        {String(getLanguageIcon(file.lang)).slice(0, 4)}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                        {getBaseName(tabName)}
                      </span>
                      {isDirty ? <span className="codesense-mono" style={{ color: palette.warning, fontSize: 10 }}>*</span> : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeTab(tabName)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: palette.textMuted,
                        cursor: "pointer",
                        padding: "4px 8px",
                        fontSize: 11,
                      }}
                    >
                      x
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0, flex: 1 }}>
          <div
            style={{
              ...sectionLabelStyle,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{workspaceLabel}</span>
            <span>{files.length}</span>
          </div>
          <div style={{ overflow: "auto", minHeight: 0, flex: 1 }}>
            {!files.length ? (
              <div style={{ color: palette.textMuted, fontSize: 12, lineHeight: 1.7, paddingTop: 4 }}>
                Open a folder or add files to start browsing code in the workbench.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {fileTree.map((node) => renderExplorerNodeV2(node))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          borderTop: `1px solid ${palette.border}`,
          padding: "10px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {!hasApiKey ? (
          <div
            style={{
              border: `1px solid ${palette.border}`,
              background: palette.codeBg,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: palette.textSoft }}>
              Local AI is active. Add your Anthropic API key if you want deeper cloud review and chat.
            </div>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-ant-..."
              style={inputBase}
            />
          </div>
        ) : (
          <div
            style={{
              border: `1px solid rgba(78,201,176,0.2)`,
              background: "rgba(78,201,176,0.08)",
              padding: "8px 10px",
              fontSize: 12,
              color: "#4ec9b0",
            }}
          >
            Anthropic connected
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setShowRightSidebar(true);
              setAssistantTab("review");
              activeFileData && analyzeFile(activeFileData);
            }}
            disabled={!activeFileData || !canUseAiFeatures || !!loading[activeFile]}
            style={{
              ...buttonBase,
              justifyContent: "center",
              background: palette.accent,
              borderColor: palette.accent,
              color: "#ffffff",
              opacity: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? 0.5 : 1,
              cursor: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? "not-allowed" : "pointer",
            }}
          >
            {loading[activeFile] ? "Working" : "Analyze"}
          </button>
          <button
            type="button"
            onClick={analyzeAll}
            disabled={!files.length || !canUseAiFeatures}
            style={{
              ...buttonBase,
              justifyContent: "center",
              opacity: !files.length || !canUseAiFeatures ? 0.5 : 1,
              cursor: !files.length || !canUseAiFeatures ? "not-allowed" : "pointer",
            }}
          >
            Analyze All
          </button>
        </div>
      </div>
    </div>
  );

  const renderSearchSidebarV2 = () => (
    <div
      style={{
        background: palette.sideBar,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        width: "100%",
      }}
    >
      <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${palette.border}` }}>
        <div style={sectionLabelStyle}>Search</div>
        <div style={{ marginTop: 4, fontSize: 12, color: palette.textSoft }}>
          Search across every loaded file in the workspace.
        </div>
      </div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
        <input
          value={workspaceSearch}
          onChange={(event) => setWorkspaceSearch(event.target.value)}
          placeholder="Search in files"
          style={inputBase}
        />
        <div style={{ color: palette.textMuted, fontSize: 12 }}>
          {workspaceSearch.trim() ? `${workspaceMatches.length} result(s)` : "Enter a search term to begin."}
        </div>
        <div style={{ overflow: "auto", minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>
          {!workspaceSearch.trim() ? (
            <div style={{ color: palette.textMuted, fontSize: 12, lineHeight: 1.7 }}>
              Search results appear here. Click any match to jump straight into the editor.
            </div>
          ) : !workspaceMatches.length ? (
            <div style={{ color: palette.textMuted, fontSize: 12 }}>No results found.</div>
          ) : (
            workspaceMatches.map((match, index) => (
              <button
                key={`search-${match.fileName}-${match.lineNumber}-${index}`}
                type="button"
                onClick={() => {
                  revealFilePath(match.fileName);
                  setActiveFile(match.fileName);
                  setView("editor");
                }}
                style={{
                  border: "none",
                  borderLeft: `2px solid ${activeFile === match.fileName ? palette.accent : "transparent"}`,
                  background: activeFile === match.fileName ? palette.selection : "transparent",
                  color: palette.text,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{match.fileName}</span>
                <span className="codesense-mono" style={{ color: palette.textMuted, fontSize: 10 }}>
                  line {match.lineNumber}
                </span>
                <span style={{ color: palette.textSoft, fontSize: 12, whiteSpace: "pre-wrap" }}>
                  {match.line.trim() || "(empty line)"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderExtensionsSidebarV2 = () => {
    const normalizedQuery = extensionQuery.trim().toLowerCase();
    const workspaceLanguageSet = new Set(workspaceLanguages);
    const visibleExtensions = extensions.filter((extension) => {
      const haystack = [
        extension.name,
        extension.publisher,
        extension.description,
        extension.category,
        ...(extension.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return normalizedQuery ? haystack.includes(normalizedQuery) : true;
    });

    const installedExtensions = visibleExtensions.filter((extension) => extension.installed);
    const recommendedExtensions = visibleExtensions.filter(
      (extension) =>
        !extension.installed &&
        extension.recommendedFor?.some((language) => workspaceLanguageSet.has(language))
    );
    const featuredExtensions = visibleExtensions.filter(
      (extension) =>
        !extension.installed &&
        !recommendedExtensions.some((item) => item.id === extension.id) &&
        extension.featured
    );
    const marketplaceExtensions = visibleExtensions.filter(
      (extension) =>
        !extension.installed &&
        !recommendedExtensions.some((item) => item.id === extension.id) &&
        !featuredExtensions.some((item) => item.id === extension.id)
    );

    const sections = normalizedQuery
      ? [
          {
            title: `Search Results (${visibleExtensions.length})`,
            items: visibleExtensions,
            empty: "No extensions match your search.",
          },
        ]
      : [
          {
            title: `Installed (${installedExtensions.length})`,
            items: installedExtensions,
            empty: "No installed extensions yet.",
          },
          {
            title: "Recommended",
            items: recommendedExtensions,
            empty: workspaceLanguages.length
              ? `No extra recommendations for ${workspaceLanguages.join(", ")} right now.`
              : "Open code files to unlock workspace-based recommendations.",
          },
          {
            title: "Featured",
            items: featuredExtensions,
            empty: "No featured extensions available.",
          },
          {
            title: "Marketplace",
            items: marketplaceExtensions,
            empty: "No more extensions in the local marketplace catalog.",
          },
        ];

    return (
      <div
        style={{
          background: palette.sideBar,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          width: "100%",
        }}
      >
        <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${palette.border}` }}>
          <div style={sectionLabelStyle}>Extensions</div>
          <div style={{ marginTop: 4, fontSize: 12, color: palette.textSoft }}>
            Discover, install, and manage VS Code style extensions for this workspace.
          </div>
        </div>

        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minHeight: 0,
            flex: 1,
          }}
        >
          <input
            value={extensionQuery}
            onChange={(event) => setExtensionQuery(event.target.value)}
            placeholder="Search Extensions"
            style={inputBase}
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              { label: "Installed", value: extensions.filter((item) => item.installed).length },
              { label: "Enabled", value: extensions.filter((item) => item.installed && item.enabled).length },
              { label: "Catalog", value: extensions.length },
            ].map((item) => (
              <div
                key={`extension-metric-${item.label}`}
                style={{
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  padding: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span style={{ color: palette.textMuted, fontSize: 11 }}>{item.label}</span>
                <span className="codesense-mono" style={{ color: palette.text, fontSize: 18, fontWeight: 700 }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              border: `1px solid ${palette.border}`,
              background: palette.codeBg,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: palette.textSoft }}>
              {workspaceLanguages.length
                ? `Recommended for this workspace: ${workspaceLanguages.join(", ")}`
                : "Open JavaScript, TypeScript, CSS, HTML, JSON, or Python files to get smarter recommendations."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={resetExtensionsCatalog}
                style={{ ...buttonBase, justifyContent: "center" }}
              >
                Reset Catalog
              </button>
              <button
                type="button"
                onClick={() => setExtensionQuery("")}
                style={{ ...buttonBase, justifyContent: "center" }}
              >
                Clear Search
              </button>
            </div>
          </div>

          <div style={{ overflow: "auto", minHeight: 0, flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            {sections.map((section) => (
              <div key={`extension-section-${section.title}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={sectionLabelStyle}>{section.title}</div>
                {!section.items.length ? (
                  <div
                    style={{
                      border: `1px solid ${palette.border}`,
                      background: palette.codeBg,
                      padding: 12,
                      color: palette.textMuted,
                      fontSize: 12,
                      lineHeight: 1.7,
                    }}
                  >
                    {section.empty}
                  </div>
                ) : (
                  section.items.map((extension) => {
                    const recommended = extension.recommendedFor?.some((language) =>
                      workspaceLanguageSet.has(language)
                    );
                    return (
                      <div
                        key={extension.id}
                        style={{
                          border: `1px solid ${
                            extension.installed && extension.enabled
                              ? `${palette.accent}55`
                              : palette.border
                          }`,
                          background: extension.installed ? palette.panel : palette.codeBg,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: palette.text }}>
                              {extension.name}
                            </div>
                            <div style={{ marginTop: 3, fontSize: 11, color: palette.textMuted }}>
                              {extension.publisher} • v{extension.version}
                            </div>
                          </div>
                          <span
                            className="codesense-mono"
                            style={{
                              fontSize: 10,
                              color: extension.installed ? palette.accent : palette.textMuted,
                              border: `1px solid ${extension.installed ? `${palette.accent}55` : palette.border}`,
                              padding: "2px 6px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {extension.category.toUpperCase()}
                          </span>
                        </div>

                        <div style={{ fontSize: 12, color: palette.textSoft, lineHeight: 1.65 }}>
                          {extension.description}
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          <span style={{ padding: "2px 6px", border: `1px solid ${palette.border}`, fontSize: 11, color: palette.textSoft }}>
                            {extension.rating.toFixed(1)} star
                          </span>
                          <span style={{ padding: "2px 6px", border: `1px solid ${palette.border}`, fontSize: 11, color: palette.textSoft }}>
                            {extension.installsLabel} installs
                          </span>
                          {recommended ? (
                            <span style={{ padding: "2px 6px", border: `1px solid ${palette.accent}55`, fontSize: 11, color: palette.accent }}>
                              Recommended
                            </span>
                          ) : null}
                          {extension.builtIn ? (
                            <span style={{ padding: "2px 6px", border: `1px solid ${palette.border}`, fontSize: 11, color: palette.textMuted }}>
                              Built In
                            </span>
                          ) : null}
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {!extension.installed ? (
                            <button
                              type="button"
                              onClick={() => installExtension(extension.id)}
                              style={{
                                ...buttonBase,
                                justifyContent: "center",
                                background: palette.accentSoft,
                                borderColor: palette.accent,
                                color: palette.text,
                              }}
                            >
                              Install
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleExtensionEnabled(extension.id)}
                              style={{
                                ...buttonBase,
                                justifyContent: "center",
                                background: extension.enabled ? palette.accentSoft : palette.panelAlt,
                                borderColor: extension.enabled ? palette.accent : palette.border,
                                color: extension.enabled ? palette.text : palette.textSoft,
                              }}
                            >
                              {extension.enabled ? "Disable" : "Enable"}
                            </button>
                          )}
                          {extension.installed && !extension.builtIn ? (
                            <button
                              type="button"
                              onClick={() => uninstallExtension(extension.id)}
                              style={{ ...buttonBase, justifyContent: "center" }}
                            >
                              Uninstall
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setTransientNotice("info", `${extension.name} by ${extension.publisher}`);
                            }}
                            style={{ ...buttonBase, justifyContent: "center" }}
                          >
                            Details
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderReviewWorkbenchV2 = () => (
    <div
      style={{
        background: palette.sideBar,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        width: "100%",
      }}
    >
      <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${palette.border}` }}>
        <div style={sectionLabelStyle}>Code Review</div>
        <div style={{ marginTop: 4, fontSize: 12, color: palette.textSoft }}>
          Code review and bug-fix tools embedded like a VS Code extension panel.
        </div>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto", minHeight: 0, flex: 1 }}>
        <div
          style={{
            border: `1px solid ${hasApiKey ? "rgba(78,201,176,0.2)" : aiInlineBorder}`,
            background: hasApiKey ? "rgba(78,201,176,0.08)" : aiInlineBackground,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: hasApiKey ? "#4ec9b0" : aiInlineColor }}>
              {hasApiKey ? "Anthropic connected" : "Local AI active"}
            </span>
            <button type="button" onClick={() => setShowKey((prev) => !prev)} style={buttonBase}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Anthropic API key"
            style={inputBase}
          />
        </div>

        <div style={sectionLabelStyle}>Review Mode</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {Object.entries(MODE_CONFIG).map(([key, item]) => (
            <button
              key={`mode-${key}`}
              type="button"
              onClick={() => setMode(key)}
              style={{
                ...buttonBase,
                justifyContent: "space-between",
                background: mode === key ? palette.accentSoft : palette.panelAlt,
                borderColor: mode === key ? palette.accent : palette.border,
                color: mode === key ? palette.text : palette.textSoft,
              }}
            >
              <span>{item.label}</span>
              <span className="codesense-mono" style={{ fontSize: 10 }}>{item.icon}</span>
            </button>
          ))}
        </div>

        <div style={sectionLabelStyle}>Actions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setShowRightSidebar(true);
              setAssistantTab("review");
              activeFileData && analyzeFile(activeFileData);
            }}
            disabled={!activeFileData || !canUseAiFeatures || !!loading[activeFile]}
            style={{
              ...buttonBase,
              justifyContent: "center",
              background: palette.accent,
              borderColor: palette.accent,
              color: "#ffffff",
              opacity: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? 0.5 : 1,
              cursor: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? "not-allowed" : "pointer",
            }}
          >
            Analyze Active
          </button>
          <button
            type="button"
            onClick={analyzeAll}
            disabled={!files.length || !canUseAiFeatures}
            style={{
              ...buttonBase,
              justifyContent: "center",
              opacity: !files.length || !canUseAiFeatures ? 0.5 : 1,
              cursor: !files.length || !canUseAiFeatures ? "not-allowed" : "pointer",
            }}
          >
            Analyze All
          </button>
          <button
            type="button"
            onClick={() => setView("diff")}
            disabled={!activeResult?.fixedCode}
            style={{
              ...buttonBase,
              justifyContent: "center",
              opacity: !activeResult?.fixedCode ? 0.5 : 1,
              cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
            }}
          >
            Open Diff
          </button>
          <button
            type="button"
            onClick={applyFixedCodeToEditor}
            disabled={!activeResult?.fixedCode}
            style={{
              ...buttonBase,
              justifyContent: "center",
              opacity: !activeResult?.fixedCode ? 0.5 : 1,
              cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
            }}
          >
            Apply Fix
          </button>
        </div>

        <button type="button" onClick={handleExportReport} style={{ ...buttonBase, justifyContent: "center" }}>
          Export Review Report
        </button>

        <div style={sectionLabelStyle}>Workspace Health</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {[
            { label: "Files", value: files.length },
            { label: "Avg Quality", value: analyzedFiles.length ? avgQuality : "--" },
            { label: "Issues", value: totalIssues },
            { label: "Critical", value: criticalIssues },
          ].map((item) => (
            <div
              key={`metric-${item.label}`}
              style={{
                border: `1px solid ${palette.border}`,
                background: palette.codeBg,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span style={{ color: palette.textMuted, fontSize: 11 }}>{item.label}</span>
              <span className="codesense-mono" style={{ color: palette.text, fontSize: 18, fontWeight: 700 }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>

        <div style={sectionLabelStyle}>Quick Snippet</div>
        <input
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
          placeholder="snippet.tsx"
          style={inputBase}
        />
        <textarea
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
          placeholder="Paste code here to add a review target into the workspace."
          style={{
            ...inputBase,
            minHeight: 140,
            resize: "vertical",
            fontFamily: EDITOR_FONT,
          }}
        />
        <button
          type="button"
          onClick={handleManualAdd}
          style={{
            ...buttonBase,
            justifyContent: "center",
            background: palette.panel,
            color: palette.text,
          }}
        >
          Add Snippet To Workspace
        </button>
      </div>
    </div>
  );

  const renderWorkbenchSidebarV2 = () => {
    if (activity === "search") return renderSearchSidebarV2();
    if (activity === "extensions") return renderExtensionsSidebarV2();
    if (activity === "review") return renderReviewWorkbenchV2();
    if (activity === "git") return renderGitPanel();
    return renderSidebarV2();
  };

  const renderActivityRailV2 = () => {
    const items = [
      {
        id: "explorer",
        short: "EX",
        label: "Explorer",
        active: activity === "explorer",
        onClick: () => {
          setActivity("explorer");
          setView("editor");
        },
      },
      {
        id: "search",
        short: "SR",
        label: "Search",
        active: activity === "search",
        onClick: () => {
          setActivity("search");
          setView("editor");
        },
      },
      {
        id: "git",
        short: "SC",
        label: "Source Control",
        active: activity === "git",
        onClick: () => {
          setActivity("git");
          setView("editor");
        },
      },
      {
        id: "extensions",
        short: "XT",
        label: "Extensions",
        active: activity === "extensions",
        onClick: openExtensionsPanel,
      },
      {
        id: "review",
        short: "AI",
        label: "Code Review",
        active: (activity === "review" || (showRightSidebar && assistantTab === "review")) && centerView !== "chat",
        onClick: () => {
          setActivity("review");
          setAssistantTab("review");
          setShowRightSidebar(true);
          setView("editor");
        },
      },
      {
        id: "chat",
        short: "CH",
        label: "Chat",
        active: centerView === "chat",
        onClick: openMainChat,
      },
      {
        id: "dashboard",
        short: "DB",
        label: "Dashboard",
        active: centerView === "dashboard",
        onClick: () => {
          setActivity("review");
          setView("dashboard");
        },
      },
    ];

    return (
      <div
        style={{
          width: 48,
          minWidth: 48,
          background: palette.activityBar,
          borderRight: `1px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            height: 48,
            display: "grid",
            placeItems: "center",
            borderBottom: `1px solid ${palette.border}`,
          }}
        >
          <span className="codesense-mono" style={{ fontSize: 11, color: palette.text, fontWeight: 700 }}>
            CS
          </span>
        </div>
        {items.map((item) => (
          <button
            key={`rail-${item.id}`}
            type="button"
            title={item.label}
            onClick={item.onClick}
            style={{
              border: "none",
              borderLeft: `2px solid ${item.active ? palette.activityActive : "transparent"}`,
              background: item.active ? palette.panelAlt : "transparent",
              color: item.active ? palette.activityActive : palette.activityIcon,
              height: 48,
              cursor: "pointer",
              padding: 0,
              display: "grid",
              placeItems: "center",
              fontFamily: EDITOR_FONT,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.7,
            }}
          >
            {item.short}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          title="Settings"
          onClick={() => setShowSettings(true)}
          style={{
            border: "none",
            borderLeft: "2px solid transparent",
            background: "transparent",
            color: palette.activityIcon,
            height: 48,
            cursor: "pointer",
            padding: 0,
            display: "grid",
            placeItems: "center",
            fontFamily: EDITOR_FONT,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.7,
          }}
        >
          ST
        </button>
      </div>
    );
  };

  const renderIDEHeaderV2 = () => {
    const menuItems = [
      { label: "File", action: launchFilePicker },
      { label: "Edit", action: () => setShowFindReplace(true) },
      { label: "Selection", action: () => setCommandPaletteOpen(true) },
      { label: "View", action: () => setShowRightSidebar((prev) => !prev) },
      { label: "Extensions", action: openExtensionsPanel },
      { label: "Go", action: () => setActivity("explorer") },
      { label: "Run", action: () => activeFileData && analyzeFile(activeFileData) },
      { label: "Terminal", action: () => setShowBottomPanel(true) },
      { label: "Help", action: () => setShowWelcome(true) },
    ];

    return (
      <div
        style={{
          background: palette.titleBar,
          borderBottom: `1px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 30,
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 10,
            padding: "0 10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: palette.accent,
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 12, color: palette.text, fontWeight: 600 }}>CodeSense AI</span>
          </div>

          <div
            style={{
              fontSize: 12,
              color: palette.textSoft,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeFileData ? `${getBaseName(activeFileData.name)} - ${workspaceLabel}` : `${workspaceLabel} - CodeSense AI`}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                padding: "2px 6px",
                border: `1px solid ${aiInlineBorder}`,
                background: aiInlineBackground,
                color: aiInlineColor,
                fontSize: 11,
              }}
            >
              {hasApiKey ? "AI Ready" : "Local AI"}
            </span>
            {activeResult && !activeResult.error ? (
              <span
                style={{
                  padding: "2px 6px",
                  border: `1px solid ${scoreColor(activeResult.score)}44`,
                  color: scoreColor(activeResult.score),
                  fontSize: 11,
                }}
              >
                Score {activeResult.score}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              style={{ ...buttonBase, padding: "2px 8px", minHeight: 22, fontSize: 11 }}
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </div>

        <div
          style={{
            minHeight: 34,
            display: "grid",
            gridTemplateColumns: isCompact ? "1fr" : "auto 1fr auto",
            alignItems: "center",
            gap: 10,
            padding: "0 10px",
            background: palette.panelAlt,
            borderTop: `1px solid ${theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}`,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {menuItems.map((item) => (
              <button
                key={`menu-${item.label}`}
                type="button"
                onClick={item.action}
                style={{
                  border: "none",
                  background: "transparent",
                  color: palette.textSoft,
                  cursor: "pointer",
                  padding: "6px 8px",
                  fontSize: 12,
                  fontFamily: UI_FONT,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            style={{
              ...buttonBase,
              justifyContent: "space-between",
              width: "100%",
              minHeight: 24,
              background: palette.inputBg || palette.panel,
              color: palette.textSoft,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeFileData ? activeFileData.name : "Search files, commands, and review tools"}
            </span>
            <span className="codesense-mono" style={{ color: palette.textMuted, fontSize: 10 }}>
              Ctrl+Shift+P
            </span>
          </button>

          <div style={{ display: "flex", justifyContent: isCompact ? "flex-start" : "flex-end", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setActivity("review");
                setAssistantTab("review");
                setShowRightSidebar(true);
              }}
              style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}
            >
              Mode: {MODE_CONFIG[mode]?.label}
            </button>
            <button
              type="button"
              onClick={() => activeFileData && analyzeFile(activeFileData)}
              disabled={!activeFileData || !canUseAiFeatures || !!loading[activeFile]}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 24,
                background: palette.accentSoft,
                borderColor: palette.accent,
                color: palette.text,
                opacity: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? 0.5 : 1,
                cursor: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? "not-allowed" : "pointer",
              }}
            >
              Analyze
            </button>
            <button
              type="button"
              onClick={() => setView("diff")}
              disabled={!activeResult?.fixedCode}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 24,
                opacity: !activeResult?.fixedCode ? 0.5 : 1,
                cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
              }}
            >
              Diff
            </button>
            <button
              type="button"
              onClick={() => setShowRightSidebar((prev) => !prev)}
              style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}
            >
              {showRightSidebar ? "Hide AI" : "Show AI"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEditorTabsV2 = () => (
    <div
      style={{
        display: "flex",
        overflow: "auto",
        background: palette.panelAlt,
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      {openTabs.length ? (
        openTabs.map((tabName) => {
          const file = files.find((item) => item.name === tabName);
          if (!file) return null;
          const isActive = activeFile === tabName;
          const isDirty = isFileDirty(tabName);
          return (
            <div
              key={`tab-v2-${tabName}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                height: 35,
                padding: "0 10px",
                borderRight: `1px solid ${palette.border}`,
                borderTop: `1px solid ${isActive ? palette.accent : "transparent"}`,
                background: isActive ? palette.panel : palette.panelAlt,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveFile(tabName);
                  setView("editor");
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isActive ? palette.text : palette.textSoft,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 0,
                  minWidth: 0,
                  fontSize: 12,
                }}
              >
                <span className="codesense-mono" style={{ width: 22, color: isActive ? palette.text : palette.textMuted, fontSize: 10 }}>
                  {String(getLanguageIcon(file.lang)).slice(0, 4)}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                  {getBaseName(tabName)}
                </span>
                {isDirty ? <span className="codesense-mono" style={{ fontSize: 10, color: palette.warning }}>*</span> : null}
              </button>
              <button
                type="button"
                onClick={() => closeTab(tabName)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: palette.textMuted,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 11,
                }}
              >
                x
              </button>
            </div>
          );
        })
      ) : (
        <div style={{ display: "grid", placeItems: "center", height: 35, padding: "0 12px", color: palette.textMuted, fontSize: 12 }}>
          No open editors
        </div>
      )}
    </div>
  );

  const renderEditorSurfaceV2 = () => {
    if (centerView === "chat") {
      return <div style={{ minHeight: 0, display: "flex", flex: 1 }}>{renderChat()}</div>;
    }

    if (!activeFileData) {
      return (
        <div
          style={{
            ...panelStyle,
            flex: 1,
            minHeight: 420,
            background: palette.codeBg,
            padding: isCompact ? 20 : 32,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
          }}
        >
          <div style={{ width: "min(760px, 100%)", display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <div style={{ ...sectionLabelStyle, marginBottom: 8 }}>Start</div>
              <div style={{ fontSize: isCompact ? 24 : 30, fontWeight: 700, color: palette.text }}>
                CodeSense AI Workbench
              </div>
              <div style={{ marginTop: 10, color: palette.textSoft, fontSize: 14, lineHeight: 1.7 }}>
                A VS Code style workspace with built-in code review, bug-fix, diff, and AI chat tools.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isCompact ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {[
                {
                  title: "Open Folder",
                  body: "Load a local project and browse it in the explorer.",
                  action: launchFolderPicker,
                },
                {
                  title: "Open File",
                  body: "Bring in one or more files for review and editing.",
                  action: launchFilePicker,
                },
                {
                  title: "Code Review Panel",
                  body: "Open the embedded review and bug-fix workbench.",
                  action: () => setActivity("review"),
                },
                {
                  title: "Extensions",
                  body: "Browse and manage IDE extensions like VS Code.",
                  action: openExtensionsPanel,
                },
                {
                  title: "Command Palette",
                  body: "Jump to commands, files, actions, and shortcuts.",
                  action: () => setCommandPaletteOpen(true),
                },
              ].map((item) => (
                <button
                  key={`welcome-action-${item.title}`}
                  type="button"
                  onClick={item.action}
                  style={{
                    border: `1px solid ${palette.border}`,
                    background: palette.panel,
                    color: palette.text,
                    textAlign: "left",
                    padding: 16,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: palette.textSoft, lineHeight: 1.6 }}>{item.body}</span>
                </button>
              ))}
            </div>

            <div
              style={{
                border: `1px solid ${palette.border}`,
                background: palette.panel,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={sectionLabelStyle}>Keyboard Shortcuts</div>
              {[
                ["Ctrl+P", "Quick open"],
                ["Ctrl+Shift+P", "Open command palette"],
                ["Ctrl+,", "Open settings"],
                ["Ctrl+Enter", "Analyze active file"],
                ["Ctrl+D", "Open diff"],
                ["Ctrl+K", "Open main chat"],
                ["Ctrl+S", "Save active file"],
                ["Ctrl+Shift+S", "Save all dirty files"],
              ].map(([key, value]) => (
                <div key={`shortcut-${key}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                  <span className="codesense-mono" style={{ color: palette.accent }}>{key}</span>
                  <span style={{ color: palette.textSoft }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (centerView === "dashboard") {
      return <div style={{ minHeight: 0, display: "flex", flex: 1 }}>{renderDashboard()}</div>;
    }

    if (centerView === "diff") {
      return <div style={{ minHeight: 0, display: "flex", flex: 1 }}>{renderDiffCenter()}</div>;
    }

    const breadcrumbs = normalizeFilePath(activeFileData.name).split("/").filter(Boolean);

    return (
      <div
        style={{
          ...panelStyle,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: palette.panel,
        }}
      >
        {renderEditorTabsV2()}

        <div
          style={{
            minHeight: 30,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "6px 12px",
            borderBottom: `1px solid ${palette.border}`,
            background: palette.panel,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
            <span style={{ color: palette.textMuted, fontSize: 11 }}>
              {breadcrumbs.slice(0, -1).join(" > ")}
              {breadcrumbs.length > 1 ? " > " : ""}
            </span>
            <span style={{ fontSize: 12, color: palette.text }}>{getBaseName(activeFileData.name)}</span>
            <span className="codesense-mono" style={{ color: palette.textMuted, fontSize: 10 }}>
              {String(getLanguageIcon(activeFileData.lang)).slice(0, 4)}
            </span>
            {typeof activeResult?.score === "number" ? (
              <span
                style={{
                  padding: "2px 6px",
                  border: `1px solid ${scoreColor(activeResult.score)}44`,
                  color: scoreColor(activeResult.score),
                  fontSize: 11,
                }}
              >
                Score {activeResult.score}
              </span>
            ) : null}
            {activeFileDirty ? (
              <span
                style={{
                  padding: "2px 6px",
                  border: `1px solid ${palette.warning}55`,
                  color: palette.warning,
                  fontSize: 11,
                }}
              >
                Unsaved
              </span>
            ) : null}
            {activeResult?.stale ? (
              <span
                style={{
                  padding: "2px 6px",
                  border: `1px solid ${palette.warning}55`,
                  color: palette.warning,
                  fontSize: 11,
                }}
              >
                Review stale
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setView("code")}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 24,
                background: centerView === "code" ? palette.accentSoft : palette.panelAlt,
                borderColor: centerView === "code" ? palette.accent : palette.border,
                color: centerView === "code" ? palette.text : palette.textSoft,
              }}
            >
              Code
            </button>
            <button type="button" onClick={() => setShowFindReplace(true)} style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}>
              Find
            </button>
            <button
              type="button"
              onClick={() => activeFileData && analyzeFile(activeFileData)}
              disabled={!activeFileData || !canUseAiFeatures || !!loading[activeFile]}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 24,
                background: palette.accentSoft,
                borderColor: palette.accent,
                color: palette.text,
                opacity: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? 0.5 : 1,
                cursor: !activeFileData || !canUseAiFeatures || !!loading[activeFile] ? "not-allowed" : "pointer",
              }}
            >
              {loading[activeFile] ? "Reviewing" : "Review"}
            </button>
            <button
              type="button"
              onClick={() => setView("diff")}
              disabled={!activeResult?.fixedCode}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 24,
                opacity: !activeResult?.fixedCode ? 0.5 : 1,
                cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
              }}
            >
              Diff
            </button>
            <button
              type="button"
              onClick={applyFixedCodeToEditor}
              disabled={!activeResult?.fixedCode}
              style={{
                ...buttonBase,
                padding: "4px 8px",
                minHeight: 24,
                opacity: !activeResult?.fixedCode ? 0.5 : 1,
                cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
              }}
            >
              Apply Fix
            </button>
            <button type="button" onClick={() => void saveActiveFile()} style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}>
              Save
            </button>
          </div>
        </div>

        {showFindReplace ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              padding: "8px 12px",
              borderBottom: `1px solid ${palette.border}`,
              background: palette.panelAlt,
              alignItems: "center",
            }}
          >
            <input
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder="Find"
              style={{ ...inputBase, width: 180 }}
            />
            <button
              type="button"
              onClick={() => {
                if (monacoEditorRef.current && findQuery) {
                  monacoEditorRef.current.getAction("actions.find")?.run();
                }
              }}
              style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}
            >
              Next
            </button>
            <input
              value={replaceQuery}
              onChange={(event) => setReplaceQuery(event.target.value)}
              placeholder="Replace"
              style={{ ...inputBase, width: 180 }}
            />
            <button
              type="button"
              onClick={() => {
                if (monacoEditorRef.current && findQuery) {
                  monacoEditorRef.current.trigger("keyboard", "editor.action.replaceOne", {
                    pattern: findQuery,
                    replaceString: replaceQuery,
                  });
                }
              }}
              style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}
            >
              Replace
            </button>
            <button type="button" onClick={() => setShowFindReplace(false)} style={{ ...buttonBase, padding: "4px 8px", minHeight: 24 }}>
              Close
            </button>
          </div>
        ) : null}

        <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", background: palette.codeBg }}>
          {centerView === "code" ? (
            renderCodeCenter()
          ) : !monacoReady ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", color: palette.textSoft, fontSize: 13 }}>
              Loading Monaco Editor...
            </div>
          ) : (
            <div ref={editorContainerRef} style={{ flex: 1, minHeight: 0, width: "100%", height: "100%" }} />
          )}
        </div>
      </div>
    );
  };

  const renderAssistantSidebarV2 = () => (
    <div
      style={{
        background: palette.sideBar,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        width: "100%",
      }}
    >
      <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${palette.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={sectionLabelStyle}>
              {assistantTab === "secondary"
                ? "Secondary Chat"
                : assistantTab === "chat"
                  ? "Chat"
                  : "Code Review & Bug Fix"}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: palette.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {assistantTab === "secondary"
                ? activeFileData
                  ? `Premium chat for ${activeFileData.name}`
                  : "Premium workspace assistant ready"
                : assistantTab === "chat"
                  ? activeFileData
                    ? `Chat for ${activeFileData.name}`
                    : "Workspace chat ready"
                : activeFileData
                  ? activeFileData.name
                  : "No active file selected"}
            </div>
          </div>
          <button type="button" onClick={() => setShowRightSidebar(false)} style={buttonBase}>
            Hide
          </button>
        </div>
      </div>

      <div style={{ padding: "8px 12px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${palette.border}` }}>
        <span style={{ padding: "2px 6px", border: `1px solid ${palette.border}`, fontSize: 11, color: palette.textSoft }}>
          Mode {MODE_CONFIG[mode]?.label}
        </span>
        <span
          style={{
            padding: "2px 6px",
            border: `1px solid ${aiInlineBorder}`,
            color: hasApiKey ? "#4ec9b0" : aiInlineColor,
            fontSize: 11,
          }}
        >
          {hasApiKey ? "AI Ready" : "Local AI"}
        </span>
        {activeResult && !activeResult.error ? (
          <span style={{ padding: "2px 6px", border: `1px solid ${scoreColor(activeResult.score)}44`, color: scoreColor(activeResult.score), fontSize: 11 }}>
            Score {activeResult.score}
          </span>
        ) : null}
      </div>

      <div style={{ padding: "8px 12px", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, borderBottom: `1px solid ${palette.border}` }}>
        <button
          type="button"
          onClick={toggleSecondaryChat}
          style={{
            ...buttonBase,
            justifyContent: "center",
            background: assistantTab === "secondary" ? palette.accentSoft : palette.panelAlt,
            borderColor: assistantTab === "secondary" ? palette.accent : palette.border,
            color: assistantTab === "secondary" ? palette.text : palette.textSoft,
          }}
        >
          Toggle Secondary
        </button>
        <button
          type="button"
          onClick={() => setView("diff")}
          disabled={!activeResult?.fixedCode}
          style={{
            ...buttonBase,
            justifyContent: "center",
            opacity: !activeResult?.fixedCode ? 0.5 : 1,
            cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
          }}
        >
          Diff
        </button>
        <button
          type="button"
          onClick={applyFixedCodeToEditor}
          disabled={!activeResult?.fixedCode}
          style={{
            ...buttonBase,
            justifyContent: "center",
            opacity: !activeResult?.fixedCode ? 0.5 : 1,
            cursor: !activeResult?.fixedCode ? "not-allowed" : "pointer",
          }}
        >
          Apply
        </button>
      </div>

      <div style={{ padding: "8px 12px", display: "flex", gap: 8, borderBottom: `1px solid ${palette.border}` }}>
        {[
          { id: "review", label: "Review" },
          { id: "chat", label: "Chat" },
          { id: "context", label: "Inspector" },
        ].map((tab) => (
          <button
            key={`assistant-v2-${tab.id}`}
            type="button"
            onClick={() => setAssistantTab(tab.id)}
            style={{
              ...buttonBase,
              flex: 1,
              justifyContent: "center",
              background: assistantTab === tab.id ? palette.accentSoft : palette.panelAlt,
              borderColor: assistantTab === tab.id ? palette.accent : palette.border,
              color: assistantTab === tab.id ? palette.text : palette.textSoft,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "10px 12px" }}>
        {assistantTab === "review"
          ? renderResultsPanel()
          : assistantTab === "secondary"
            ? renderChatSidebar()
            : assistantTab === "chat"
              ? renderPrimaryChatSidebar()
            : renderContextSidebar()}
      </div>
    </div>
  );

  const renderStatusBarV2 = () => {
    const leftSegments = [
      activeFileData ? getBaseName(activeFileData.name) : workspaceLabel,
      activeFileData ? capitalize(activeFileData.lang) : "No file",
      activeFileData ? (activeFileDirty ? "Unsaved" : "Saved") : "Read Only",
      `Ln ${cursorPos.line}, Col ${cursorPos.column}`,
      `Tab ${editorSettings.tabSize || 2}`,
      "UTF-8",
      editorSettings.wordWrap === "on" ? "Wrap" : "No Wrap",
    ];

    const rightSegments = [
      { label: `Branch ${gitBranch}`, onClick: () => setActivity("git") },
      {
        label:
          serverHealth.state === "connected"
            ? "Server On"
            : serverHealth.state === "offline"
              ? "Server Off"
              : "Server ...",
        onClick: () => setView("dashboard"),
      },
      { label: MODE_CONFIG[mode]?.label || "Review", onClick: () => setActivity("review") },
      { label: hasApiKey ? "AI Ready" : "Local AI", onClick: () => setShowRightSidebar(true) },
      {
        label:
          centerView === "dashboard"
            ? "Dashboard"
            : centerView === "diff"
              ? "Diff"
              : centerView === "code"
                ? "Code"
                : "Editor",
      },
      { label: `${zoom}%`, onClick: () => setZoom((value) => Math.min(value + 10, 200)) },
    ];

    return (
      <div
        style={{
          height: 22,
          background: palette.statusBar,
          color: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "0 10px",
          fontSize: 11,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, overflow: "hidden" }}>
          {leftSegments.map((item, index) => (
            <span key={`status-left-${item}-${index}`} style={{ opacity: index === 0 ? 1 : 0.92, whiteSpace: "nowrap" }}>
              {item}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {rightSegments.map((item, index) => (
            <span
              key={`status-right-${item.label}-${index}`}
              onClick={item.onClick}
              style={{
                opacity: 0.95,
                whiteSpace: "nowrap",
                cursor: item.onClick ? "pointer" : "default",
              }}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderWelcomeScreenV2 = () => {
    if (!showWelcome) return null;

    const dismissWelcome = () => {
      setShowWelcome(false);
      if (typeof window !== "undefined") {
        localStorage.setItem("codesense-welcomed", "true");
      }
    };

    const actions = [
      { title: "Open Folder", body: "Browse a local project in the explorer.", action: launchFolderPicker },
      { title: "Open File", body: "Review one or more standalone files.", action: launchFilePicker },
      {
        title: "Review Panel",
        body: "Open the embedded Code Review and Bug Fix workbench.",
        action: () => {
          setActivity("review");
          setShowRightSidebar(true);
        },
      },
      {
        title: "Extensions",
        body: "Open the extensions marketplace and manage installed tools.",
        action: openExtensionsPanel,
      },
      { title: "Command Palette", body: "Jump anywhere with keyboard-first commands.", action: () => setCommandPaletteOpen(true) },
    ];

    return (
      <div
        onClick={dismissWelcome}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.62)",
          display: "grid",
          placeItems: "center",
          zIndex: 100,
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(860px, calc(100vw - 40px))",
            maxHeight: "84vh",
            overflow: "auto",
            border: `1px solid ${palette.border}`,
            background: palette.panel,
            padding: isCompact ? 22 : 28,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div>
            <div style={sectionLabelStyle}>Welcome</div>
            <div style={{ marginTop: 8, fontSize: isCompact ? 26 : 32, fontWeight: 700, color: palette.text }}>
              CodeSense AI
            </div>
            <div style={{ marginTop: 8, color: palette.textSoft, lineHeight: 1.7 }}>
              A VS Code inspired build with the Code Review and Bug Fix tool embedded directly into the workspace.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isCompact ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {actions.map((item) => (
              <button
                key={`welcome-v2-${item.title}`}
                type="button"
                onClick={() => {
                  dismissWelcome();
                  item.action();
                }}
                style={{
                  border: `1px solid ${palette.border}`,
                  background: palette.codeBg,
                  color: palette.text,
                  textAlign: "left",
                  padding: 16,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{item.title}</span>
                <span style={{ fontSize: 12, color: palette.textSoft, lineHeight: 1.6 }}>{item.body}</span>
              </button>
            ))}
          </div>

          <div
            style={{
              border: `1px solid ${palette.border}`,
              background: palette.codeBg,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={sectionLabelStyle}>Built In</div>
            {[
              "Monaco editor with tabs, breadcrumbs, diff view, and bottom dock.",
              "Explorer, search, source control, AI review panel, and status bar.",
              "Code review, bug fixing, workspace chat, report export, and snippet import.",
            ].map((item) => (
              <div key={`welcome-built-${item}`} style={{ color: palette.textSoft, fontSize: 13, lineHeight: 1.6 }}>
                {item}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: palette.textMuted, fontSize: 12 }}>
              Tip: use Ctrl+Shift+P for commands, Ctrl+Enter to review, and Ctrl+K for AI chat.
            </span>
            <button type="button" onClick={dismissWelcome} style={{ ...buttonBase, color: palette.text }}>
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderWorkArea = () => {
    const leftWidth = isThreeColumn ? 300 : isTwoColumn ? 280 : "100%";
    const rightWidth = isThreeColumn ? 370 : isTwoColumn ? 330 : "100%";
    const mainDirection = isTwoColumn ? "row" : "column";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          background: palette.bg,
        }}
      >
        {renderIDEHeaderV2()}

        <div
          style={{
            display: "flex",
            flexDirection: mainDirection,
            gap: 0,
            minHeight: 0,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              width: isTwoColumn ? leftWidth : "100%",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {renderActivityRailV2()}
            {isTwoColumn ? (
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  display: "flex",
                  overflow: "hidden",
                  borderRight: `1px solid ${palette.border}`,
                }}
              >
                {renderWorkbenchSidebarV2()}
              </div>
            ) : null}
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {renderEditorSurfaceV2()}
          </div>

          {showRightSidebar ? (
            <div
              style={{
                width: isTwoColumn ? rightWidth : "100%",
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                overflow: "hidden",
                borderLeft: `1px solid ${palette.border}`,
              }}
            >
              {renderAssistantSidebarV2()}
            </div>
          ) : null}
        </div>

        {showBottomPanel ? renderBottomDock() : null}
        {renderStatusBarV2()}
        {renderCommandPalette()}
        {renderSettingsModal()}
        {renderWelcomeScreenV2()}
      </div>
    );
  };

  return (
    <div
      style={{
        height: "100vh",
        background: palette.bg,
        color: palette.text,
        fontFamily: UI_FONT,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <style>{`
        html, body, #root { margin: 0; height: 100%; overflow: hidden; background: ${palette.bg}; }
        * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: ${palette.scrollbar} transparent; }
        *::-webkit-scrollbar { width: 6px; height: 6px; }
        *::-webkit-scrollbar-thumb { background: ${palette.scrollbar}; border-radius: 3px; }
        *::-webkit-scrollbar-track { background: transparent; }
        button:hover { filter: brightness(1.1); }
        button:active { filter: brightness(0.95); }
        button:disabled:hover { filter: none; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder, textarea::placeholder { color: ${palette.textMuted}; }
        pre, code, .codesense-mono { font-family: ${EDITOR_FONT}; }
      `}</style>

      {notice ? (
        <div
          style={{
            position: "fixed",
            top: 40,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 6,
            minWidth: 300,
            maxWidth: "80vw",
            border: notice.type === "error" 
              ? "1px solid #f14c4c" 
              : notice.type === "info"
                ? "1px solid #007acc"
                : "1px solid #4ec9b0",
            background: notice.type === "error" 
              ? "rgba(44, 33, 33, 0.98)" 
              : notice.type === "info"
                ? "rgba(20, 40, 60, 0.98)"
                : "rgba(20, 40, 30, 0.98)",
            color: notice.type === "error" 
              ? "#f14c4c" 
              : notice.type === "info"
                ? "#3794ff"
                : "#4ec9b0",
            fontSize: 13,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ fontSize: 16 }}>
            {notice.type === "error" ? "⚠" : notice.type === "info" ? "ℹ" : "✓"}
          </span>
          <span style={{ flex: 1, color: palette.text }}>
            {notice.text}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            style={{
              border: "none",
              background: "transparent",
              color: palette.textMuted,
              cursor: "pointer",
              padding: 4,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {renderWorkArea()}
    </div>
  );
}
