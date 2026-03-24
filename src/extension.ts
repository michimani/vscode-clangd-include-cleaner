import * as vscode from "vscode";
import { removeUnusedIncludesInDocument, isUnusedIncludeDiagnostic } from "./remover";
import { logger } from "./logger";

// Language IDs for C/C++ files
const CPP_LANGUAGE_IDS = new Set(["c", "cpp", "cuda-cpp"]);

export function activate(context: vscode.ExtensionContext): void {
  logger.info("C++ Unused Includes Remover activated.");

  // ---- Command: apply to current file ----
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cppUnusedIncludes.removeInCurrentFile",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor.");
          return;
        }
        if (!isCppDocument(editor.document)) {
          vscode.window.showWarningMessage(
            "Not a C/C++ file."
          );
          return;
        }
        const removed = await removeUnusedIncludesInDocument(editor.document);
        vscode.window.showInformationMessage(
          removed > 0
            ? `Removed ${removed} unused include(s).`
            : "No unused includes found."
        );
      }
    )
  );

  // ---- Command: apply to entire workspace ----
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cppUnusedIncludes.removeInWorkspace",
      async () => {
        await runWorkspaceCleanup();
      }
    )
  );

  // ---- Command: dump diagnostics for current file (debug) ----
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cppUnusedIncludes.dumpDiagnostics",
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor.");
          return;
        }
        const uri = editor.document.uri;
        const all = vscode.languages.getDiagnostics(uri);
        logger.info(`=== dumpDiagnostics: ${editor.document.fileName} (${all.length} entries) ===`);
        if (all.length === 0) {
          logger.info("  (no diagnostics — language server may not be running or compile_commands.json is missing)");
        }
        for (const d of all) {
          logger.info(`  source="${d.source}" code="${formatCode(d.code)}" severity=${d.severity} line=${d.range.start.line + 1} message="${d.message}"`);
        }
        logger.info("=== end ===");
        vscode.window.showInformationMessage(`Dumped ${all.length} diagnostic(s) to Output.`);
      }
    )
  );

  // ---- On-save hook ----
  // Uses onDidSaveTextDocument instead of onWillSaveTextDocument.
  // The pre-save hook may fire while clangd is clearing diagnostics,
  // causing getDiagnostics() to return empty results.
  const processingFiles = new Set<string>();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration("cppUnusedIncludes");
      if (!config.get<boolean>("enableOnSave", true)) {
        return;
      }
      if (!isCppDocument(document)) {
        return;
      }
      // Re-entry guard: removeUnusedIncludesInDocument calls document.save() internally
      const key = document.uri.toString();
      if (processingFiles.has(key)) {
        return;
      }
      processingFiles.add(key);
      try {
        await applyOnSave(document);
      } finally {
        processingFiles.delete(key);
      }
    })
  );

  logger.info("Event handlers registered.");
}

export function deactivate(): void {
  logger.info("C++ Unused Includes Remover deactivated.");
}

// ---------------------------------------------------------------------------
// On-save handler: wait for diagnostics to settle, then apply fixes
// ---------------------------------------------------------------------------
async function applyOnSave(document: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration("cppUnusedIncludes");
  const waitMs = config.get<number>("waitForDiagnosticsMs", 100);
  const source = config.get<string>("diagnosticSource", "clangd");

  logger.info(`[onSave] ${document.fileName}: saved, waiting ${waitMs}ms for diagnostics (source="${source}")`);
  await delay(waitMs);

  const allDiagnostics = vscode.languages.getDiagnostics(document.uri);
  if (allDiagnostics.length === 0) {
    logger.info(`[onSave] ${document.fileName}: no diagnostics (language server may still be analyzing — try increasing waitForDiagnosticsMs)`);
    return;
  }

  logger.info(`[onSave] ${document.fileName}: ${allDiagnostics.length} diagnostic(s):`);
  for (const d of allDiagnostics) {
    logger.info(`  source="${d.source}" code="${formatCode(d.code)}" severity=${d.severity} message="${d.message}"`);
  }

  const edits = await collectUnusedIncludeEdits(document, source, allDiagnostics);
  logger.info(`[onSave] ${document.fileName}: ${edits.length} unused include(s) to remove`);

  if (edits.length === 0) {
    return;
  }

  // Apply edits via WorkspaceEdit and save
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.delete(document.uri, edit.range);
  }
  const success = await vscode.workspace.applyEdit(workspaceEdit);
  if (success) {
    await document.save();
  } else {
    logger.warn(`[onSave] ${document.fileName}: failed to apply WorkspaceEdit`);
  }
}

// ---------------------------------------------------------------------------
// Workspace-wide cleanup
// ---------------------------------------------------------------------------
async function runWorkspaceCleanup(): Promise<void> {
  const config = vscode.workspace.getConfiguration("cppUnusedIncludes");
  const glob = config.get<string>(
    "workspaceFileGlob",
    "**/*.{cpp,cc,cxx,c,h,hpp,hxx}"
  );

  const files = await vscode.workspace.findFiles(
    glob,
    "**/node_modules/**"
  );

  if (files.length === 0) {
    vscode.window.showInformationMessage("No matching files found.");
    return;
  }

  let totalRemoved = 0;
  let processedFiles = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "C++ Unused Includes Remover",
      cancellable: true,
    },
    async (progress, token) => {
      for (const uri of files) {
        if (token.isCancellationRequested) {
          break;
        }

        progress.report({
          message: `Processing (${processedFiles + 1}/${files.length}): ${vscode.workspace.asRelativePath(uri)}`,
          increment: 100 / files.length,
        });

        try {
          const document = await vscode.workspace.openTextDocument(uri);
          const removed = await removeUnusedIncludesInDocument(document);
          totalRemoved += removed;
          processedFiles++;
        } catch (err) {
          logger.warn(`Failed to process ${uri.fsPath}: ${err}`);
        }
      }
    }
  );

  vscode.window.showInformationMessage(
    `Processed ${processedFiles} file(s), removed ${totalRemoved} unused include(s) in total.`
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function isCppDocument(document: vscode.TextDocument): boolean {
  return CPP_LANGUAGE_IDS.has(document.languageId);
}

function formatCode(code: vscode.Diagnostic["code"]): string {
  if (code === undefined) return "";
  if (typeof code === "object") return String(code.value);
  return String(code);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: collect TextEdits for unused includes from pre-fetched diagnostics
async function collectUnusedIncludeEdits(
  document: vscode.TextDocument,
  source: string,
  allDiagnostics: vscode.Diagnostic[]
): Promise<vscode.TextEdit[]> {
  const diagnostics = allDiagnostics
    .filter((d) => isUnusedIncludeDiagnostic(d, source));

  if (diagnostics.length === 0) {
    return [];
  }

  // Sort descending by line number to avoid line-number drift when deleting
  diagnostics.sort((a, b) => b.range.start.line - a.range.start.line);

  const edits: vscode.TextEdit[] = [];
  for (const diag of diagnostics) {
    const lineRange = getFullLineRange(document, diag.range.start.line);
    edits.push(vscode.TextEdit.delete(lineRange));
  }
  return edits;
}

/**
 * Returns the Range covering the entire line (including the newline),
 * or to end-of-line for the last line.
 */
function getFullLineRange(
  document: vscode.TextDocument,
  lineIndex: number
): vscode.Range {
  const line = document.lineAt(lineIndex);
  if (lineIndex < document.lineCount - 1) {
    return new vscode.Range(
      lineIndex,
      0,
      lineIndex + 1,
      0
    );
  }
  // Last line: no trailing newline
  return new vscode.Range(lineIndex, 0, lineIndex, line.text.length);
}
