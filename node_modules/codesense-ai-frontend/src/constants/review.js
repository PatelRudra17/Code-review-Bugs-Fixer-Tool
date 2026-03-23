export const SEV_COLOR = {
  critical: "#ff3b3b",
  high: "#ff6b35",
  medium: "#ffd700",
  low: "#4ade80",
  info: "#60a5fa",
};

export const MODE_CONFIG = {
  full: {
    label: "Full Review",
    icon: "FULL",
    focus:
      "COMPREHENSIVE review covering bugs, security, performance, style, logic, edge cases, maintainability, and developer experience.",
  },
  bugs: {
    label: "Bug Fix",
    icon: "BUG",
    focus:
      "Find ALL bugs, logic errors, runtime failures, null/undefined risks, data corruption paths, and edge cases. Prefer concrete fixes.",
  },
  security: {
    label: "Security",
    icon: "SEC",
    focus:
      "Focus on OWASP concerns, injection vectors, XSS, auth flaws, secret exposure, SSRF, and unsafe input handling.",
  },
  performance: {
    label: "Performance",
    icon: "PERF",
    focus:
      "Focus on bottlenecks, memory leaks, expensive loops, O(n^2) work, unnecessary re-renders, blocking I/O, and avoidable allocations.",
  },
  refactor: {
    label: "Refactor",
    icon: "REF",
    focus:
      "Focus on readability, maintainability, better naming, modularity, modern syntax, clearer control flow, and cleaner architecture.",
  },
  explain: {
    label: "Explain",
    icon: "INFO",
    focus:
      "Explain every important part clearly for a junior developer while still surfacing risky or confusing code and providing cleaner corrected output.",
  },
};

export const VIEW_CONFIG = {
  editor: { label: "Editor", icon: "EDIT" },
  diff: { label: "Diff", icon: "DIFF" },
  dashboard: { label: "Dashboard", icon: "DASH" },
  chat: { label: "AI Chat", icon: "CHAT" },
};

export const VALID_GRADES = ["A+", "A", "B", "C", "D", "F"];
export const VALID_SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const VALID_CATEGORIES = [
  "Bug",
  "Security",
  "Performance",
  "Style",
  "Logic",
  "Maintainability",
];
export const MAX_CHAT_HISTORY = 8;
