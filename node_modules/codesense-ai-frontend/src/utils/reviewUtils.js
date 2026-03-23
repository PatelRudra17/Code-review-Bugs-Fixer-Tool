import {
  MAX_CHAT_HISTORY,
  VALID_CATEGORIES,
  VALID_GRADES,
  VALID_SEVERITIES,
} from "../constants/review";

export function gradeFromScore(score) {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function scoreColor(score) {
  if (typeof score !== "number") return "#94a3b8";
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#facc15";
  if (score >= 40) return "#fb923c";
  return "#ef4444";
}

export function gradeColor(grade) {
  if (grade === "A+" || grade === "A") return "#22c55e";
  if (grade === "B") return "#84cc16";
  if (grade === "C") return "#facc15";
  if (grade === "D") return "#fb923c";
  if (grade === "F") return "#ef4444";
  return "#94a3b8";
}

export function metricColor(metricName, value) {
  const lower = String(value || "").toLowerCase();
  const isComplexity = metricName === "complexity";
  if (isComplexity) {
    if (lower === "low") return "#22c55e";
    if (lower === "medium") return "#facc15";
    if (lower === "high") return "#fb923c";
    return "#94a3b8";
  }
  if (lower === "high") return "#22c55e";
  if (lower === "medium") return "#facc15";
  if (lower === "low") return "#ef4444";
  return "#94a3b8";
}

export function normalizeMetricValue(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "low" || lower === "medium" || lower === "high") return lower;
  return "medium";
}

export function normalizeIssue(issue, index) {
  const severity = VALID_SEVERITIES.includes(String(issue?.severity || "").toLowerCase())
    ? String(issue.severity).toLowerCase()
    : "medium";
  const category = VALID_CATEGORIES.includes(issue?.category)
    ? issue.category
    : "Maintainability";
  const rawLine = Number(issue?.line);
  const line = Number.isFinite(rawLine) && rawLine > 0 ? Math.round(rawLine) : null;
  return {
    id: String(issue?.id || `issue-${index + 1}`),
    severity,
    category,
    line,
    title: String(issue?.title || "Untitled issue"),
    description: String(issue?.description || "No description provided."),
    fix: String(issue?.fix || ""),
    explanation: String(issue?.explanation || ""),
  };
}

export function extractJsonString(raw = "") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!cleaned) return "{}";
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (error) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return cleaned.slice(firstBrace, lastBrace + 1);
    }
    return cleaned;
  }
}

export function normalizeResult(parsed, originalCode) {
  const safeParsed = parsed && typeof parsed === "object" ? parsed : {};
  const score =
    typeof safeParsed.score === "number" && Number.isFinite(safeParsed.score)
      ? Math.max(0, Math.min(100, Math.round(safeParsed.score)))
      : 0;
  const grade = VALID_GRADES.includes(safeParsed.grade)
    ? safeParsed.grade
    : gradeFromScore(score);
  return {
    summary: String(
      safeParsed.summary ||
        "Analysis completed, but the model returned a limited summary. Review the issue list and fixed output below."
    ),
    score,
    grade,
    issues: Array.isArray(safeParsed.issues)
      ? safeParsed.issues.map(normalizeIssue)
      : [],
    fixedCode:
      typeof safeParsed.fixedCode === "string" && safeParsed.fixedCode.trim()
        ? safeParsed.fixedCode
        : originalCode,
    improvements: Array.isArray(safeParsed.improvements)
      ? safeParsed.improvements.map((item) => String(item)).filter(Boolean)
      : [],
    metrics: {
      complexity: normalizeMetricValue(safeParsed.metrics?.complexity),
      maintainability: normalizeMetricValue(safeParsed.metrics?.maintainability),
      testability: normalizeMetricValue(safeParsed.metrics?.testability),
      documentation: normalizeMetricValue(safeParsed.metrics?.documentation),
    },
  };
}

export function trimHistory(messages) {
  return messages.slice(-MAX_CHAT_HISTORY);
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatTimestamp(timestamp) {
  if (!timestamp) return "Not analyzed yet";
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return String(timestamp);
  }
}

export async function copyText(text) {
  if (!text) return;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function getSeverityCounts(issues = []) {
  return issues.reduce(
    (acc, issue) => {
      acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  );
}

export function computeDiff(original = "", fixed = "") {
  const a = String(original || "").split("\n");
  const b = String(fixed || "").split("\n");
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ type: "same", lineA: i + 1, lineB: j + 1, text: a[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (i >= a.length) {
      rows.push({ type: "add", lineA: null, lineB: j + 1, text: b[j] });
      j += 1;
      continue;
    }
    if (j >= b.length) {
      rows.push({ type: "remove", lineA: i + 1, lineB: null, text: a[i] });
      i += 1;
      continue;
    }
    rows.push({ type: "remove", lineA: i + 1, lineB: null, text: a[i] });
    rows.push({ type: "add", lineA: null, lineB: j + 1, text: b[j] });
    i += 1;
    j += 1;
  }
  return rows;
}
