import * as vscode from "vscode";
import { logger } from "./logger";

/**
 * Removes all unused #include directives in the given TextDocument
 * and returns the number of lines removed.
 *
 * Relies on clangd diagnostics being available before this function is called.
 */
export async function removeUnusedIncludesInDocument(
  document: vscode.TextDocument
): Promise<number> {
  const config = vscode.workspace.getConfiguration("cppUnusedIncludes");
  const source = config.get<string>("diagnosticSource", "clangd");

  const diagnostics = vscode.languages
    .getDiagnostics(document.uri)
    .filter((d) => isUnusedIncludeDiagnostic(d, source));

  if (diagnostics.length === 0) {
    logger.info(`${document.fileName}: no unused includes found`);
    return 0;
  }

  logger.info(
    `${document.fileName}: ${diagnostics.length} unused include(s) detected`
  );

  // Sort descending by line number to avoid line-number drift when deleting
  diagnostics.sort((a, b) => b.range.start.line - a.range.start.line);

  const workspaceEdit = new vscode.WorkspaceEdit();
  const deletedLines = new Set<number>();

  for (const diag of diagnostics) {
    const lineIndex = diag.range.start.line;

    // Skip duplicate diagnostics on the same line
    if (deletedLines.has(lineIndex)) {
      continue;
    }

    // Safety check: verify the line is actually an #include
    const lineText = document.lineAt(lineIndex).text;
    if (!isIncludeLine(lineText)) {
      logger.warn(
        `line ${lineIndex + 1} is not an #include, skipping: "${lineText}"`
      );
      continue;
    }

    const lineRange = getFullLineRange(document, lineIndex);
    workspaceEdit.delete(document.uri, lineRange);
    deletedLines.add(lineIndex);

    logger.info(`  removing line ${lineIndex + 1}: "${lineText.trim()}"`);
  }

  const success = await vscode.workspace.applyEdit(workspaceEdit);
  if (!success) {
    logger.warn(`${document.fileName}: failed to apply WorkspaceEdit`);
    return 0;
  }

  // Save changes to disk
  await document.save();

  return deletedLines.size;
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Returns true if the diagnostic represents an unused include from the
 * configured source (default: "clangd").
 *
 * Matches on:
 *   - code === "unused-includes" (clangd 16+)
 *   - OR message contains "unused" and "include" (fallback)
 */
export function isUnusedIncludeDiagnostic(
  diag: vscode.Diagnostic,
  configuredSource: string
): boolean {
  if (diag.source !== configuredSource) {
    return false;
  }
  // clangd 16+: code may be an object { value, target }
  const codeValue = typeof diag.code === "object" ? diag.code.value : diag.code;
  if (codeValue === "unused-includes") {
    return true;
  }
  // Fallback: message-based detection
  const msg = diag.message.toLowerCase();
  return msg.includes("unused") && msg.includes("include");
}

/**
 * Returns true if the given text is a #include directive.
 */
function isIncludeLine(text: string): boolean {
  return /^\s*#\s*include\s*[<"]/.test(text);
}

/**
 * Returns a Range covering the entire line including its trailing newline.
 * For the last line, returns a range to end-of-line without a newline.
 */
function getFullLineRange(
  document: vscode.TextDocument,
  lineIndex: number
): vscode.Range {
  if (lineIndex < document.lineCount - 1) {
    return new vscode.Range(lineIndex, 0, lineIndex + 1, 0);
  }
  const lineLength = document.lineAt(lineIndex).text.length;
  return new vscode.Range(lineIndex, 0, lineIndex, lineLength);
}
