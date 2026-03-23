import { MODE_CONFIG } from "../constants/review";
import { capitalize, countLines, detectLanguage } from "../utils/fileUtils";
import { gradeFromScore } from "../utils/reviewUtils";

const JS_LIKE_LANGUAGES = new Set([
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
]);

const TS_LIKE_LANGUAGES = new Set(["typescript", "tsx"]);

const ISSUE_PENALTIES = {
  critical: 18,
  high: 11,
  medium: 6,
  low: 2,
  info: 1,
};

const SEVERITY_RANK = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countMatches(content, matcher) {
  const source = String(content || "");
  if (!source) return 0;

  const regex =
    matcher instanceof RegExp
      ? new RegExp(
          matcher.source,
          matcher.flags.includes("g") ? matcher.flags : `${matcher.flags}g`
        )
      : new RegExp(String(matcher), "g");
  const matches = source.match(regex);
  return matches ? matches.length : 0;
}

function getLineNumber(content, matcher) {
  const source = String(content || "");
  if (!source) return null;

  const regex =
    matcher instanceof RegExp
      ? new RegExp(
          matcher.source,
          matcher.flags.includes("g") ? matcher.flags : `${matcher.flags}g`
        )
      : new RegExp(String(matcher), "g");
  const match = regex.exec(source);
  if (!match || typeof match.index !== "number") return null;
  return source.slice(0, match.index).split("\n").length;
}

function addIssue(issues, issue) {
  issues.push({
    id: `local-${issues.length + 1}`,
    severity: issue.severity || "medium",
    category: issue.category || "Maintainability",
    line: issue.line ?? null,
    title: issue.title || "Observation",
    description: issue.description || "",
    fix: issue.fix || "",
    explanation: issue.explanation || "",
  });
}

function getLineStats(content) {
  const lines = String(content || "").split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const commentLines = lines.filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("--")
    );
  }).length;
  const longLineCount = lines.filter((line) => line.length > 120).length;
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);

  return {
    lines,
    lineCount: countLines(content),
    nonEmptyLineCount: nonEmptyLines.length,
    commentLines,
    commentRatio: nonEmptyLines.length ? commentLines / nonEmptyLines.length : 0,
    longLineCount,
    maxLineLength,
  };
}

function collectAnalysisSignals(file) {
  const content = String(file?.content || "");
  const language = file?.lang || detectLanguage(file?.name);
  const stats = getLineStats(content);
  const isReactFile =
    /from\s+['"]react['"]/.test(content) ||
    /<[A-Z][A-Za-z0-9]*/.test(content) ||
    language === "jsx" ||
    language === "tsx";
  const isConfigLike =
    /\.(json|ya?ml|toml|ini|env|txt|md|robots\.txt)$/i.test(String(file?.name || "")) ||
    ["json", "text", "md", "css", "html"].includes(language);

  return {
    language,
    isReactFile,
    isConfigLike,
    ...stats,
    importCount: countMatches(content, /^\s*import\s+/gm),
    exportCount: countMatches(content, /^\s*export\s+/gm),
    functionCount:
      countMatches(content, /\bfunction\b/g) +
      countMatches(content, /\=\>\s*[{(]?/g),
    branchCount:
      countMatches(content, /\b(if|switch|case|for|while|catch)\b/g) +
      countMatches(content, /\?\s*[^:]+:/g),
    consoleCount: countMatches(content, /console\.(log|warn|debug|info)\s*\(/g),
    todoCount: countMatches(content, /\b(TODO|FIXME|HACK|XXX)\b/g),
    looseEqualityCount: countMatches(
      content,
      /(^|[^=!<>])==(?!=)|(^|[^=!<>])!=(?!=)/gm
    ),
    varCount: countMatches(content, /\bvar\s+[A-Za-z_$]/g),
    parseIntNoRadixCount: countMatches(
      content,
      /\bparseInt\(\s*[^,()]+\s*\)/g
    ),
    anyTypeCount: TS_LIKE_LANGUAGES.has(language)
      ? countMatches(content, /(:\s*any\b|<\s*any\s*>|\bas\s+any\b)/g)
      : 0,
    tsDirectiveCount: countMatches(content, /@ts-ignore|@ts-nocheck/g),
    stateHookCount: countMatches(content, /\buseState\s*\(/g),
    effectHookCount: countMatches(content, /\buseEffect\s*\(/g),
    inlineStyleCount: countMatches(content, /style=\{\{/g),
    fetchCount: countMatches(
      content,
      /\b(fetch|axios\.(get|post|put|delete|patch)|client\.(get|post|put|delete|patch))\s*\(/g
    ),
    tryCount: countMatches(content, /\btry\s*{/g),
    catchCount: countMatches(content, /\bcatch\s*\(/g),
    sideEffectCount: countMatches(
      content,
      /document\.|window\.|localStorage|sessionStorage|fetch\(|axios\.|setInterval\(|setTimeout\(/g
    ),
    jsxNodeCount: isReactFile ? countMatches(content, /<[A-Za-z][^/>]*?>/g) : 0,
    hasTests:
      /\.(test|spec)\.(js|jsx|ts|tsx|py)$/i.test(String(file?.name || "")) ||
      /\b(describe|it|test|expect|assert)\s*\(/.test(content),
    hasCommenting: stats.commentLines > 0,
  };
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    const severityDelta =
      (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (severityDelta !== 0) return severityDelta;
    const lineA = Number.isFinite(a.line) ? a.line : Number.MAX_SAFE_INTEGER;
    const lineB = Number.isFinite(b.line) ? b.line : Number.MAX_SAFE_INTEGER;
    return lineA - lineB;
  });
}

function collectCandidateIssues(file, signals) {
  const content = String(file?.content || "");
  const issues = [];

  if (/eval\s*\(/.test(content)) {
    addIssue(issues, {
      severity: "critical",
      category: "Security",
      line: getLineNumber(content, /eval\s*\(/),
      title: "Avoid eval in production code",
      description:
        "Dynamic code execution creates a code-injection risk and makes runtime behavior much harder to trust.",
      fix: "Replace eval with explicit parsing, a lookup table, or a constrained expression parser.",
      explanation:
        "Removing eval closes off an entire class of remote-code and input-manipulation bugs.",
    });
  }

  if (/dangerouslySetInnerHTML|innerHTML\s*=/.test(content)) {
    addIssue(issues, {
      severity: "high",
      category: "Security",
      line: getLineNumber(content, /dangerouslySetInnerHTML|innerHTML\s*=/),
      title: "Unsanitized HTML rendering risk",
      description:
        "Rendering raw HTML can expose the UI to XSS if untrusted content ever reaches this path.",
      fix: "Sanitize the markup or render structured content through normal components.",
      explanation:
        "HTML injection issues often stay dormant until a new data source or user input reaches the same code path.",
    });
  }

  if (
    /(api[_-]?key|secret|token|password)\s*[:=]\s*['"`][^'"`\n]{4,}['"`]/i.test(content)
  ) {
    addIssue(issues, {
      severity: "high",
      category: "Security",
      line: getLineNumber(
        content,
        /(api[_-]?key|secret|token|password)\s*[:=]\s*['"`][^'"`\n]{4,}['"`]/i
      ),
      title: "Possible hard-coded secret",
      description:
        "A secret-like literal appears to be committed in source, which is unsafe for both client and server projects.",
      fix: "Move the value into environment configuration or a secure backend secret store.",
      explanation:
        "Hard-coded secrets spread quickly through source control, logs, and built bundles.",
    });
  }

  if (signals.looseEqualityCount > 0 && JS_LIKE_LANGUAGES.has(signals.language)) {
    addIssue(issues, {
      severity: signals.looseEqualityCount > 2 ? "medium" : "low",
      category: "Bug",
      line: getLineNumber(content, /(^|[^=!<>])==(?!=)|(^|[^=!<>])!=(?!=)/m),
      title: "Use strict equality",
      description:
        "Loose equality can coerce values in surprising ways and hide edge-case logic bugs.",
      fix: "Replace == and != with === and !== where type coercion is not explicitly intended.",
      explanation:
        "Strict comparisons make runtime behavior more predictable and easier to debug.",
    });
  }

  if (signals.varCount > 0 && JS_LIKE_LANGUAGES.has(signals.language)) {
    addIssue(issues, {
      severity: "medium",
      category: "Maintainability",
      line: getLineNumber(content, /\bvar\s+[A-Za-z_$]/),
      title: "Prefer block-scoped declarations",
      description:
        "var is function-scoped and increases the chance of hoisting surprises or accidental reuse.",
      fix: "Use let or const so the variable lifetime matches the surrounding block.",
      explanation:
        "Block scoping improves readability and avoids hard-to-spot reassignment bugs.",
    });
  }

  if (signals.parseIntNoRadixCount > 0 && JS_LIKE_LANGUAGES.has(signals.language)) {
    addIssue(issues, {
      severity: "low",
      category: "Bug",
      line: getLineNumber(content, /\bparseInt\(\s*[^,()]+\s*\)/),
      title: "parseInt should include a radix",
      description:
        "Leaving out the radix is easy to misread and can create subtle parsing ambiguity.",
      fix: "Call parseInt(value, 10) when parsing base-10 input.",
      explanation:
        "Being explicit improves both runtime predictability and code clarity.",
    });
  }

  if (/catch\s*\([^)]*\)\s*{\s*}/.test(content)) {
    addIssue(issues, {
      severity: "medium",
      category: "Logic",
      line: getLineNumber(content, /catch\s*\([^)]*\)\s*{\s*}/),
      title: "Empty catch block hides failures",
      description:
        "Swallowing an exception without logging or recovery turns real errors into silent broken state.",
      fix: "Handle the error explicitly, log useful context, or rethrow after cleanup.",
      explanation:
        "Silent failures usually surface later as hard-to-reproduce UI or data bugs.",
    });
  }

  if (/setInterval\s*\(/.test(content) && !/clearInterval\s*\(/.test(content)) {
    addIssue(issues, {
      severity: "medium",
      category: "Performance",
      line: getLineNumber(content, /setInterval\s*\(/),
      title: "Interval may never be cleaned up",
      description:
        "Long-lived intervals can continue running after the relevant workflow is gone.",
      fix: "Store the interval id and clear it during cleanup or when the task completes.",
      explanation:
        "Cleanup prevents duplicate timers, background work, and avoidable memory use.",
    });
  }

  if (signals.fetchCount > 0 && signals.tryCount === 0 && signals.catchCount === 0) {
    addIssue(issues, {
      severity: "medium",
      category: "Logic",
      line: getLineNumber(
        content,
        /\b(fetch|axios\.(get|post|put|delete|patch)|client\.(get|post|put|delete|patch))\s*\(/
      ),
      title: "Network call has no explicit failure path",
      description:
        "The file performs a request but does not show obvious error handling nearby.",
      fix: "Wrap the request in try/catch or surface an explicit failure state to the caller.",
      explanation:
        "Most production bugs around data loading come from unhandled unhappy-path behavior.",
    });
  }

  if (signals.consoleCount > 0) {
    addIssue(issues, {
      severity: signals.consoleCount > 3 ? "medium" : "low",
      category: "Style",
      line: getLineNumber(content, /console\.(log|warn|debug|info)\s*\(/),
      title:
        signals.consoleCount > 1
          ? "Multiple debug logs left in source"
          : "Leftover console logging",
      description:
        "Debug logging can clutter production output and hide real operational signals.",
      fix: "Remove the log or route it through a structured logger/debug utility.",
      explanation:
        "Intentional logging is much easier to trust than leftover development output.",
    });
  }

  if (signals.todoCount > 0) {
    addIssue(issues, {
      severity: "info",
      category: "Maintainability",
      line: getLineNumber(content, /\b(TODO|FIXME|HACK|XXX)\b/),
      title: "Tracked follow-up still in code",
      description:
        "This file contains TODO/FIXME style markers that likely represent unfinished work or deliberate debt.",
      fix: "Complete the follow-up or convert it into a tracked issue outside the hot code path.",
      explanation:
        "Markers are useful, but they should remain visible and intentional rather than permanent.",
    });
  }

  if (signals.lineCount > 220) {
    addIssue(issues, {
      severity: signals.lineCount > 340 ? "high" : "medium",
      category: "Maintainability",
      line: 1,
      title: "Large file is carrying too much responsibility",
      description: `This file is ${signals.lineCount} lines long, which increases review cost and makes focused edits riskier.`,
      fix: "Split the file into smaller components, hooks, helpers, or domain-specific modules.",
      explanation:
        "Smaller units are easier to reason about, test, review, and safely change.",
    });
  }

  if (signals.longLineCount >= 5) {
    addIssue(issues, {
      severity: signals.longLineCount >= 12 ? "medium" : "low",
      category: "Style",
      line: getLineNumber(content, /^.{121,}$/m),
      title: "Several lines are hard to scan",
      description: `${signals.longLineCount} line${
        signals.longLineCount === 1 ? "" : "s"
      } exceed 120 characters, which hurts readability in reviews and diffs.`,
      fix: "Wrap chained expressions, break long JSX props, or extract repeated objects into named constants.",
      explanation:
        "Readable line length makes debugging and side-by-side diffing much easier.",
    });
  }

  if (signals.importCount >= 14) {
    addIssue(issues, {
      severity: signals.importCount >= 20 ? "high" : "medium",
      category: "Maintainability",
      line: 1,
      title: "Wide dependency surface in a single file",
      description: `The file imports ${signals.importCount} modules, which is a sign it may be coordinating too many concerns.`,
      fix: "Extract helper logic, UI pieces, or domain adapters so the file owns fewer direct dependencies.",
      explanation:
        "Reducing import surface usually improves clarity and lowers coupling.",
    });
  }

  if (signals.branchCount >= 12) {
    addIssue(issues, {
      severity: signals.branchCount >= 18 ? "high" : "medium",
      category: "Logic",
      line: 1,
      title: "Control flow is getting complex",
      description: `The file contains about ${signals.branchCount} branches/decision points, which raises the chance of missed edge cases.`,
      fix: "Extract condition-heavy paths into named helpers or split scenarios into smaller units.",
      explanation:
        "Complex branching becomes expensive to test and easy to regress during refactors.",
    });
  }

  if (signals.anyTypeCount > 0) {
    addIssue(issues, {
      severity: signals.anyTypeCount >= 3 ? "medium" : "low",
      category: "Maintainability",
      line: getLineNumber(content, /(:\s*any\b|<\s*any\s*>|\bas\s+any\b)/),
      title: "Type safety is being bypassed with any",
      description: `The file uses 'any' ${signals.anyTypeCount} time${
        signals.anyTypeCount === 1 ? "" : "s"
      }, which weakens TypeScript guarantees.`,
      fix: "Replace any with narrower interfaces, union types, or generic constraints.",
      explanation:
        "Reducing 'any' usage improves editor help, refactor confidence, and runtime safety.",
    });
  }

  if (signals.tsDirectiveCount > 0) {
    addIssue(issues, {
      severity: "high",
      category: "Bug",
      line: getLineNumber(content, /@ts-ignore|@ts-nocheck/),
      title: "TypeScript safety is being suppressed",
      description:
        "A ts-ignore or ts-nocheck directive is masking compiler feedback in this file.",
      fix: "Resolve the underlying type mismatch and remove the directive where possible.",
      explanation:
        "Suppressed type errors often hide real runtime bugs and make future refactors riskier.",
    });
  }

  if (signals.stateHookCount >= 6 || signals.effectHookCount >= 4) {
    addIssue(issues, {
      severity: "medium",
      category: "Performance",
      line: 1,
      title: "Component state/effect load is high",
      description: `This file uses ${signals.stateHookCount} state hook${
        signals.stateHookCount === 1 ? "" : "s"
      } and ${signals.effectHookCount} effect hook${
        signals.effectHookCount === 1 ? "" : "s"
      }, which suggests multiple responsibilities are mixed together.`,
      fix: "Move repeated state transitions or effects into custom hooks and split view concerns from data concerns.",
      explanation:
        "Heavy hook coordination is a common source of re-render churn and hard-to-trace UI bugs.",
    });
  }

  if (signals.inlineStyleCount >= 4) {
    addIssue(issues, {
      severity: "low",
      category: "Style",
      line: getLineNumber(content, /style=\{\{/),
      title: "Heavy inline styling in component code",
      description:
        "The file contains multiple inline style blocks, which can make components harder to scan and maintain.",
      fix: "Extract repeated style objects, class names, or design tokens into shared UI primitives.",
      explanation:
        "Separating styling concerns usually makes UI components easier to review and reuse.",
    });
  }

  if (
    signals.isReactFile &&
    signals.jsxNodeCount >= 40 &&
    signals.lineCount >= 180
  ) {
    addIssue(issues, {
      severity: "medium",
      category: "Maintainability",
      line: 1,
      title: "Large UI component may be doing too much",
      description:
        "This React-oriented file renders a large amount of JSX and has grown beyond a small, focused component.",
      fix: "Split the component into smaller presentational pieces and isolate complex state into hooks.",
      explanation:
        "Large components are harder to test, review, and reason about when behavior changes.",
    });
  }

  if (!signals.hasCommenting && signals.lineCount > 140 && !signals.isConfigLike) {
    addIssue(issues, {
      severity: "low",
      category: "Maintainability",
      line: 1,
      title: "Low documentation density for a larger file",
      description:
        "The file is fairly large but contains very little inline guidance for future readers.",
      fix: "Add a few targeted comments around non-obvious branches, data transforms, or tricky effects.",
      explanation:
        "A small amount of well-placed explanation pays off when the file grows over time.",
    });
  }

  return sortIssues(issues);
}

function filterIssuesForMode(issues, modeKey) {
  if (!issues.length) return issues;

  if (modeKey === "security") {
    return issues.filter(
      (issue) => issue.category === "Security" || issue.severity === "critical"
    );
  }
  if (modeKey === "performance") {
    return issues.filter(
      (issue) =>
        issue.category === "Performance" ||
        issue.title.includes("Large file") ||
        issue.title.includes("Component state/effect load")
    );
  }
  if (modeKey === "bugs") {
    return issues.filter(
      (issue) =>
        issue.category === "Bug" ||
        issue.category === "Logic" ||
        issue.severity === "critical"
    );
  }
  if (modeKey === "refactor") {
    return issues.filter(
      (issue) =>
        issue.category === "Maintainability" || issue.category === "Style"
    );
  }
  if (modeKey === "explain") {
    return issues.slice(0, 4);
  }

  return issues;
}

function buildFallbackObservation(file, modeKey, signals) {
  const label = MODE_CONFIG[modeKey]?.label || capitalize(modeKey || "full");
  return [
    {
      id: "local-1",
      severity: "info",
      category: "Maintainability",
      line: 1,
      title: "No obvious hot spots found",
      description: `The offline analyzer did not detect a strong ${label.toLowerCase()} risk in ${file.name}. The file is ${signals.lineCount} lines long with ${signals.importCount} imports and ${signals.branchCount} branch points.`,
      fix: "Use cloud analysis for deeper semantic feedback, or keep reviewing the file manually for domain-specific risks.",
      explanation:
        "Local mode focuses on structural and pattern-based signals rather than full code understanding.",
    },
  ];
}

function applySafeFixes(content, language) {
  let fixed = String(content || "");

  if (JS_LIKE_LANGUAGES.has(language)) {
    fixed = fixed.replace(/\bvar\s+/g, "let ");
    fixed = fixed.replace(/(^|[^=!<>])==(?!=)/gm, "$1===");
    fixed = fixed.replace(/(^|[^=!<>])!=(?!=)/gm, "$1!==");
    fixed = fixed.replace(/\bparseInt\(\s*([^,()]+?)\s*\)/g, "parseInt($1, 10)");
  }

  return fixed;
}

function buildMetrics(signals, issues) {
  const severeIssues = issues.filter(
    (issue) => issue.severity === "critical" || issue.severity === "high"
  ).length;
  const complexityLoad =
    signals.branchCount + Math.max(0, signals.stateHookCount - 2) + signals.effectHookCount;

  return {
    complexity:
      complexityLoad >= 18 || signals.lineCount > 260
        ? "high"
        : complexityLoad >= 8 || signals.lineCount > 120
          ? "medium"
          : "low",
    maintainability:
      severeIssues > 0 ||
      signals.lineCount > 240 ||
      signals.importCount > 16 ||
      issues.length >= 5
        ? "low"
        : signals.lineCount > 110 || signals.importCount > 8 || issues.length >= 3
          ? "medium"
          : "high",
    testability:
      signals.hasTests
        ? "high"
        : signals.sideEffectCount >= 4 && signals.functionCount <= 2
          ? "low"
          : signals.functionCount >= 1
            ? "medium"
            : "low",
    documentation:
      signals.commentRatio >= 0.06 || signals.lineCount <= 40
        ? "high"
        : signals.commentRatio >= 0.02
          ? "medium"
          : signals.lineCount > 120
            ? "low"
            : "medium",
  };
}

function computeScore(signals, issues, metrics) {
  let score = 96;
  const metricPenalty = {
    complexity: { low: 0, medium: 5, high: 11 },
    maintainability: { high: 0, medium: 4, low: 12 },
    testability: { high: 0, medium: 2, low: 7 },
    documentation: { high: 0, medium: 1, low: 5 },
  };

  score -= issues.reduce(
    (sum, issue) => sum + (ISSUE_PENALTIES[issue.severity] || 0),
    0
  );
  score -= clampNumber(Math.round((signals.lineCount - 40) / 18), 0, 12);
  score -= clampNumber(Math.round((signals.branchCount - 4) * 1.2), 0, 10);
  score -= clampNumber(Math.round((signals.importCount - 8) * 1.1), 0, 8);
  score -= clampNumber(signals.longLineCount, 0, 8);
  score -= clampNumber(signals.anyTypeCount * 2, 0, 10);
  score -= clampNumber(signals.tsDirectiveCount * 6, 0, 12);
  score -= clampNumber(signals.consoleCount > 2 ? signals.consoleCount - 2 : 0, 0, 4);
  score -= clampNumber(signals.stateHookCount - 4, 0, 6);
  score -= clampNumber((signals.effectHookCount - 2) * 2, 0, 6);
  score -= clampNumber(signals.inlineStyleCount - 4, 0, 4);
  score -= metricPenalty.complexity[metrics.complexity] || 0;
  score -= metricPenalty.maintainability[metrics.maintainability] || 0;

  if (!signals.isConfigLike) {
    score -= metricPenalty.testability[metrics.testability] || 0;
    score -= metricPenalty.documentation[metrics.documentation] || 0;
  }

  if (metrics.documentation === "high") score += 2;
  if (signals.hasTests) score += 4;
  if (signals.lineCount <= 60 && issues.length <= 1) score += 2;
  if (signals.isConfigLike && issues.length <= 1) score += 1;

  return clampNumber(Math.round(score), 28, 97);
}

function buildSummary(file, modeKey, issues, signals, metrics) {
  const label = MODE_CONFIG[modeKey]?.label || capitalize(modeKey || "full");
  const languageLabel = capitalize(signals.language || detectLanguage(file?.name));
  const issueCountLabel = `${issues.length} issue${issues.length === 1 ? "" : "s"}`;

  if (!issues.length || (issues.length === 1 && issues[0].severity === "info")) {
    return `Local ${label.toLowerCase()} inspected ${file.name} (${languageLabel}, ${signals.lineCount} lines). Complexity looks ${metrics.complexity}, maintainability looks ${metrics.maintainability}, testability looks ${metrics.testability}, and the file does not show a strong pattern-based risk right now.`;
  }

  if (issues.every((issue) => issue.severity === "info")) {
    const topIssue = issues[0];
    return `Local ${label.toLowerCase()} found ${issueCountLabel} in ${file.name}. These are low-risk review notes, mainly around ${topIssue.category.toLowerCase()}, and the file looks stable overall with ${signals.lineCount} lines and ${metrics.maintainability} maintainability.`;
  }

  const topIssue = issues[0];
  return `Local ${label.toLowerCase()} found ${issueCountLabel} in ${file.name}. Complexity looks ${metrics.complexity}, maintainability looks ${metrics.maintainability}, and the strongest signal is ${topIssue.severity} ${topIssue.category.toLowerCase()} feedback around "${topIssue.title}". The file currently has ${signals.importCount} imports across ${signals.branchCount} decision points.`;
}

function buildImprovements(issues, language, signals, metrics) {
  const suggestions = issues.map((issue) => issue.fix).filter(Boolean);

  if (signals.lineCount > 180 || metrics.complexity === "high") {
    suggestions.push(
      "Break the file into smaller focused modules so the main control flow becomes easier to review."
    );
  }
  if (signals.anyTypeCount > 0) {
    suggestions.push(
      "Replace 'any' usages with narrower interfaces or unions to improve TypeScript safety."
    );
  }
  if (signals.fetchCount > 0 && signals.tryCount === 0 && signals.catchCount === 0) {
    suggestions.push(
      "Add explicit request failure handling so the UI and callers can recover cleanly."
    );
  }
  if (metrics.documentation === "low") {
    suggestions.push(
      "Add short comments around non-obvious branches, side effects, or data transforms."
    );
  }
  if (JS_LIKE_LANGUAGES.has(language)) {
    suggestions.push(
      "Add a few smoke tests around the main control flow before shipping changes."
    );
  }

  return [...new Set(suggestions)].slice(0, 5);
}

export function runLocalReview(file, modeKey = "full") {
  const safeFile = file || { name: "untitled.txt", content: "", lang: "text" };
  const content = String(safeFile.content || "");
  const signals = collectAnalysisSignals(safeFile);
  const language = signals.language;
  const candidates = collectCandidateIssues(safeFile, signals);
  const filtered = filterIssuesForMode(candidates, modeKey);
  const issues = sortIssues(
    filtered.length
      ? filtered
      : candidates.length
        ? candidates.slice(0, 6)
        : buildFallbackObservation(safeFile, modeKey, signals)
  ).slice(0, 8);
  const metrics = buildMetrics(signals, issues);
  const score = computeScore(signals, issues, metrics);

  return {
    summary: buildSummary(safeFile, modeKey, issues, signals, metrics),
    score,
    grade: gradeFromScore(score),
    issues,
    fixedCode: applySafeFixes(content, language),
    improvements: buildImprovements(issues, language, signals, metrics),
    metrics,
  };
}

function buildIssueSummary(result) {
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  if (!issues.length) return "I do not have any flagged issues yet.";
  return issues
    .slice(0, 3)
    .map(
      (issue) =>
        `- ${capitalize(issue.severity)} ${issue.category}: ${issue.title}${
          issue.line ? ` (line ${issue.line})` : ""
        }`
    )
    .join("\n");
}

function buildTestingGuidance(file, result) {
  const fileName = file?.name || "this file";
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  if (!issues.length) {
    return `For ${fileName}, start with one happy-path test, one invalid-input test, and one regression test around the most important workflow in the file.`;
  }

  const focused = issues
    .slice(0, 3)
    .map((issue) => issue.title.toLowerCase());
  return `For ${fileName}, add tests around ${focused.join(
    ", "
  )}. Include one success case, one edge case, and one failure-path assertion so the next refactor stays safe.`;
}

export function runLocalChat({ prompt, file, result }) {
  const content = String(prompt || "").trim();
  const lower = content.toLowerCase();
  const fileName = file?.name || "the workspace";
  const analysisReady = result && !result.error;

  if (!file) {
    return "Local AI mode is active. Open or add a code file and I can summarize findings, suggest fixes, and outline tests without needing a cloud API key.";
  }

  if ((/summary|review|issue|bug|problem/.test(lower) || lower === "analyze") && analysisReady) {
    return `Local review summary for ${fileName}: score ${result.score ?? "n/a"}, grade ${result.grade ?? "n/a"}.\n${buildIssueSummary(result)}`;
  }

  if (/fix|apply|patch|improve/.test(lower)) {
    if (analysisReady && result.fixedCode && result.fixedCode !== file.content) {
      return `I prepared a local safe-fix pass for ${fileName}. Use Apply Fix to load the generated version into the editor, then inspect the diff before keeping it.`;
    }
    return `I can help improve ${fileName}, but this file does not have a generated patch yet. Run Review first, then inspect the highest-severity findings for the safest changes to apply.`;
  }

  if (/test|testing|coverage/.test(lower)) {
    return buildTestingGuidance(file, result);
  }

  if (/explain|what does|how does/.test(lower)) {
    const language = file.lang || detectLanguage(file.name);
    return `You are looking at ${fileName}, which appears to be ${capitalize(
      language
    )} code. ${
      analysisReady
        ? `The latest review scored it ${result.score} with grade ${result.grade}.`
        : "There is no review result yet, so run Review if you want issue-by-issue guidance."
    }`;
  }

  if (/api|anthropic|key/.test(lower)) {
    return "Local AI mode is already working without a key. Add an Anthropic key only if you want deeper cloud analysis and chat responses beyond the built-in offline heuristics.";
  }

  if (analysisReady) {
    return `I am in local AI mode for ${fileName}. The latest review scored it ${result.score} (${result.grade}).\n${buildIssueSummary(result)}`;
  }

  return `I am in local AI mode and ready to help with ${fileName}. Run Review to generate findings, or ask for tests, bug explanations, or cleanup ideas for the active file.`;
}
