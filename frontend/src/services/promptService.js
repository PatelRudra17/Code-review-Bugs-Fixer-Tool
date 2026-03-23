import { MODE_CONFIG } from "../constants/review";
import { capitalize, detectLanguage } from "../utils/fileUtils";

export function buildReviewSystem(mode) {
  return `You are an elite senior software engineer performing a ${mode} review. Return only raw JSON with no markdown fences, no commentary before or after the JSON, and no omitted required keys.`;
}

export function buildReviewPrompt(file, modeKey) {
  const mode = MODE_CONFIG[modeKey] || MODE_CONFIG.full;
  const lang = file.lang || detectLanguage(file.name);
  return `
Perform the following code review mode: ${mode.label}.

Focus area:
${mode.focus}

Analyze this entire file and return ONLY raw JSON with this exact schema:
{
  "summary": "string",
  "score": 0,
  "grade": "A+?A?B?C?D?F",
  "issues": [
    {
      "id": "string",
      "severity": "critical?high?medium?low?info",
      "category": "Bug?Security?Performance?Style?Logic?Maintainability",
      "line": 1,
      "title": "string",
      "description": "string",
      "fix": "string",
      "explanation": "string"
    }
  ],
  "fixedCode": "complete corrected file",
  "improvements": ["string"],
  "metrics": {
    "complexity": "low?medium?high",
    "maintainability": "low?medium?high",
    "testability": "low?medium?high",
    "documentation": "low?medium?high"
  }
}

Additional rules:
- The summary should be 2-3 sentences.
- Provide the full corrected file in fixedCode, not a patch.
- Keep issues actionable and reference the best line number possible.
- If the code is already strong, still provide honest issues or low-severity observations.
- Explain mode should remain educational for a junior developer, but still return the same JSON schema.

Filename: ${file.name}
Language: ${lang}

\`\`\`${lang}
${file.content}
\`\`\`
`.trim();
}

export function buildChatSystem(file, result) {
  const fileContext = file
    ? `Active file: ${file.name}
Language: ${file.lang}
First 3000 characters:
${file.content.slice(0, 3000)}`
    : "No active file selected.";

  const analysisContext =
    result && !result.error
      ? `Latest analysis summary:
Mode: ${MODE_CONFIG[result.mode]?.label || capitalize(result.mode || "full")}
Score: ${result.score}
Grade: ${result.grade}
Summary: ${result.summary}
Top issues:
${result.issues
  .slice(0, 6)
  .map((issue) => `- [${issue.severity}] ${issue.title} (line ${issue.line || "n/a"})`)
  .join("\n") || "- None"}`
      : "No prior analysis available for the active file.";

  return `You are CodeSense AI, an elite senior software engineer helping with code review, debugging, teaching, refactoring, and test design.

Use the active file context when helpful.
Keep answers concrete and practical.
If you mention code changes, cite relevant lines or snippets from the provided context.

${fileContext}

${analysisContext}`;
}
