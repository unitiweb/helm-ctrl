# Helm Ctrl VS Code Extension

Experimental scaffold for a VS Code sidebar that reads `helm.config.js` or `helm.config.json` from the workspace root, groups commands by section, and runs commands from the integrated terminal.

## Current behavior

- Adds a `Helm` icon to the activity bar
- Shows sections and commands from the first open workspace folder
- Runs commands in a reusable terminal rooted at the workspace folder
- Supports Helm `config.env` substitutions and `${ENV_VAR}` placeholders
- Opens `open-url ...` commands with VS Code's external URL handler
- Refreshes when `helm.config.js`, `helm.config.json`, or `.env` changes

## Notes

- `helm.config.js` is only loaded when the workspace is trusted because it executes workspace code
- The scaffold currently reads config files from the workspace root only, matching the CLI's current behavior

## Running the scaffold

1. Open the `vscode-extension/` folder in VS Code
2. Press `F5` to launch an Extension Development Host
3. Open a project that contains `helm.config.js` or `helm.config.json`
4. Click the `Helm` activity bar icon
