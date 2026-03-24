# C++ Unused Includes Remover

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/michimani.cpp-unused-includes-remover?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=michimani.cpp-unused-includes-remover)
[![License: MIT](https://img.shields.io/github/license/michimani/vscode-clangd-include-cleaner)](https://github.com/michimani/vscode-clangd-include-cleaner/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/michimani/vscode-clangd-include-cleaner/ci.yml?label=CI)](https://github.com/michimani/vscode-clangd-include-cleaner/actions)

A VS Code extension that automatically removes unused `#include` directives from C/C++ files using diagnostics from **clangd**.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-remove on save** | Removes unused includes every time you save a C/C++ file |
| **Command: current file** | Manually apply to the active file |
| **Command: workspace** | Apply to all C/C++ files in the workspace at once |
| **Debug: dump diagnostics** | Print all diagnostics for the active file to the Output panel |

## Prerequisites

- [clangd VS Code extension](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd) (`llvm-vs-code-extensions.vscode-clangd`)
- clangd binary installed on the system (clangd 17+ recommended for `-std=c++23` support)

### Installing the clangd binary

The VS Code clangd extension requires the **clangd binary** to be installed separately.

**Debian/Ubuntu (via LLVM apt repository):**
```bash
# Add LLVM GPG key
wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key \
  | sudo tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc > /dev/null

# Add repository (adjust codename: bookworm, jammy, etc.)
echo "deb http://apt.llvm.org/bookworm/ llvm-toolchain-bookworm-19 main" \
  | sudo tee /etc/apt/sources.list.d/llvm.list

sudo apt-get update && sudo apt-get install -y clangd-19
sudo update-alternatives --install /usr/bin/clangd clangd /usr/bin/clangd-19 100
```

> **Note:** The version provided by `apt-get install clangd` (without a version suffix) is typically outdated.
> Use the LLVM apt repository to get a recent version.

### Enabling unused-includes diagnostics

Create a `.clangd` file at your project root:

```yaml
Diagnostics:
  UnusedIncludes: Strict
```

To also set the C++ standard:

```yaml
CompileFlags:
  Add: [-std=c++23]
Diagnostics:
  UnusedIncludes: Strict
```

> **Note:** `compile_commands.json` is not strictly required, but clangd's accuracy improves significantly with it.
> For CMake projects: `cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -B build`
> For Make-based projects: `bear -- make`

### Using clangd alongside Microsoft C/C++ extension

If the Microsoft C/C++ extension is also installed, disable its IntelliSense engine to avoid conflicts:

```jsonc
// .vscode/settings.json
{
  "C_Cpp.intelliSenseEngine": "disabled"
}
```

With this setting, clangd handles all language features and the Microsoft C/C++ extension provides only its debugger.

## Installation

### From VSIX

```bash
npm install
npx vsce package
```

Then install the generated `.vsix` file via `Extensions: Install from VSIX...` in the Command Palette.

### Development (F5)

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

## Configuration

```jsonc
{
  // Enable auto-removal on save (default: true)
  "cppUnusedIncludes.enableOnSave": true,

  // Diagnostic source name to match against (default: "clangd")
  "cppUnusedIncludes.diagnosticSource": "clangd",

  // Milliseconds to wait after save before reading diagnostics (default: 100)
  // Increase if includes are not removed (language server still analyzing).
  "cppUnusedIncludes.waitForDiagnosticsMs": 100,

  // Glob pattern for files targeted by the workspace-wide command
  "cppUnusedIncludes.workspaceFileGlob": "**/*.{cpp,cc,cxx,c,h,hpp,hxx}"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `C++: Remove Unused Includes in Current File` | Remove unused includes from the active file |
| `C++: Remove Unused Includes in Workspace` | Apply to all C/C++ files in the workspace |
| `C++: Dump Diagnostics to Output (Debug)` | Print diagnostics for the active file to the Output panel |

Run commands from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

## Troubleshooting

### Includes are not being removed

1. Open the Output panel (`View > Output`) and select **C++ Unused Includes Remover** from the dropdown.
2. Save a C++ file and check the log.

**`no diagnostics`** — clangd is not providing diagnostics. Check that:
- The clangd VS Code extension is installed and active.
- The clangd binary is installed (`clangd --version` in the terminal).
- A `.clangd` file with `UnusedIncludes: Strict` exists at the project root.
- The file has been open long enough for clangd to finish analyzing.

**`0 unused include(s) to remove`** — Diagnostics are present but none match. Run `C++: Dump Diagnostics to Output (Debug)` and verify that `source="clangd"` entries appear.

### Timing issues

If diagnostics are not ready when the extension reads them, no includes will be removed. Increase the wait time:

```jsonc
{
  "cppUnusedIncludes.waitForDiagnosticsMs": 500
}
```

## How It Works

```
File saved
    │
    ▼
Wait waitForDiagnosticsMs (default: 100ms)
    │
    ▼
vscode.languages.getDiagnostics() — fetch diagnostics
    │
    ▼
Filter: source === "clangd"
        AND (code === "unused-includes" OR message contains "unused"+"include")
    │
    ▼
Sort by line number descending (prevents line-number drift)
    │
    ▼
Delete each #include line via WorkspaceEdit
    │
    ▼
Save document
```

## Development

### Using Dev Container (recommended)

This repository includes a [Dev Container](https://containers.dev/) configuration. You can develop the extension in a fully pre-configured environment without installing anything locally.

**Requirements:** Docker and either VS Code with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) or [GitHub Codespaces](https://github.com/features/codespaces).

1. Open the repository in VS Code.
2. When prompted, click **Reopen in Container** (or run `Dev Containers: Reopen in Container` from the Command Palette).
3. The container will automatically run `npm install` via `postCreateCommand`.
4. Once the container is ready, press `F5` to launch the Extension Development Host.

### Local Setup

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (recompile on change)
npm run watch

# Lint / format
npm run check
```

## License

MIT
