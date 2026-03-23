import { capitalize, countLines } from "../utils/fileUtils";
import { escapeHtml } from "../utils/reviewUtils";

export function exportHTML(files, results) {
  const analyzed = files
    .map((file) => ({ file, result: results[file.name] }))
    .filter(({ result }) => result && !result.error);
  if (!analyzed.length) {
    throw new Error("Analyze at least one file before exporting the report.");
  }

  const sections = analyzed
    .map(({ file, result }) => {
      const issueRows = result.issues.length
        ? result.issues
            .map(
              (issue) => `
                <tr>
                  <td>${escapeHtml(issue.severity)}</td>
                  <td>${escapeHtml(issue.category)}</td>
                  <td>${escapeHtml(issue.title)}</td>
                  <td>${escapeHtml(issue.line ?? "-")}</td>
                  <td>${escapeHtml(issue.description)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5">No issues reported.</td></tr>`;

      return `
        <section class="file-card">
          <div class="file-head">
            <div>
              <h2>${escapeHtml(file.name)}</h2>
              <p>${escapeHtml(capitalize(file.lang))} | ${countLines(file.content)} lines</p>
            </div>
            <div class="score-block">
              <span class="score">${escapeHtml(result.score)}</span>
              <span class="grade">${escapeHtml(result.grade)}</span>
            </div>
          </div>
          <p class="summary">${escapeHtml(result.summary)}</p>
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Category</th>
                <th>Title</th>
                <th>Line</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>${issueRows}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>CodeSense AI Report</title>
        <style>
          body { margin: 0; background: #08101f; color: #e2e8f0; font-family: "JetBrains Mono", monospace; padding: 32px; }
          h1, h2, p { margin: 0; }
          .hero { margin-bottom: 28px; padding: 24px; border-radius: 18px; border: 1px solid #1e293b; background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(14,165,233,0.08)); }
          .hero p { margin-top: 10px; color: #94a3b8; }
          .file-card { border: 1px solid #1e293b; background: #0d1120; border-radius: 20px; padding: 24px; margin-bottom: 18px; }
          .file-head { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 14px; }
          .file-head p { margin-top: 8px; color: #94a3b8; }
          .score-block { display: flex; align-items: center; gap: 10px; }
          .score, .grade { border-radius: 999px; padding: 8px 12px; border: 1px solid #334155; background: rgba(99, 102, 241, 0.14); }
          .summary { margin-bottom: 18px; color: #cbd5e1; line-height: 1.7; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #1e293b; vertical-align: top; }
          th { color: #94a3b8; font-weight: 600; }
        </style>
      </head>
      <body>
        <section class="hero">
          <h1>CodeSense AI Review Report</h1>
          <p>Generated on ${escapeHtml(new Date().toLocaleString())} with ${escapeHtml(
            analyzed.length
          )} analyzed file(s).</p>
        </section>
        ${sections}
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "code-review-report.html";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
