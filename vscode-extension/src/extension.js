const fs = require('fs')
const path = require('path')
const vscode = require('vscode')

const CONFIG_FILES = ['helm.config.js', 'helm.config.json']
const terminalByWorkspace = new Map()

class HelmTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChangeTreeData.event
  }

  refresh() {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element) {
    return element
  }

  async getChildren(element) {
    if (element instanceof HelmSectionItem) {
      return element.section.commands.map(command => new HelmCommandItem(element.workspaceFolder, command, element.helmVars))
    }

    const workspaceFolder = getPrimaryWorkspaceFolder()
    if (!workspaceFolder) {
      return [new HelmMessageItem('Open a workspace folder to browse Helm commands', 'No folder is open', 'info')]
    }

    const loaded = loadHelmConfig(workspaceFolder.uri.fsPath)
    if (loaded.error) {
      return [new HelmMessageItem(loaded.error, loaded.detail, 'error')]
    }

    if (!loaded.config) {
      return [new HelmMessageItem('No Helm config found', 'Create helm.config.js or helm.config.json at the workspace root', 'info')]
    }

    const sections = normalizeSections(loaded.config.sections)
    if (!sections.length) {
      return [new HelmMessageItem('No commands found', `Loaded ${path.basename(loaded.source)}`, 'info')]
    }

    const helmConfig = loaded.config.config || {}
    const helmVars = resolveHelmVars(helmConfig.env, workspaceFolder.uri.fsPath)

    return sections.map(section => new HelmSectionItem(workspaceFolder, section, helmVars))
  }
}

class HelmSectionItem extends vscode.TreeItem {
  constructor(workspaceFolder, section, helmVars) {
    super(section.name, vscode.TreeItemCollapsibleState.Expanded)
    this.workspaceFolder = workspaceFolder
    this.section = section
    this.helmVars = helmVars
    this.contextValue = 'helmSection'
    this.description = `${section.commands.length} command${section.commands.length === 1 ? '' : 's'}`
    this.iconPath = new vscode.ThemeIcon('folder-library')
  }
}

class HelmCommandItem extends vscode.TreeItem {
  constructor(workspaceFolder, commandDefinition, helmVars) {
    super(commandDefinition.name, vscode.TreeItemCollapsibleState.None)
    this.workspaceFolder = workspaceFolder
    this.commandDefinition = commandDefinition
    this.helmVars = helmVars
    this.contextValue = 'helmCommand'
    this.description = commandDefinition.desc || commandDefinition.cmd
    this.iconPath = new vscode.ThemeIcon('play-circle')
    this.tooltip = buildCommandTooltip(commandDefinition, helmVars)
    this.command = {
      command: 'helmCtrl.runCommand',
      title: 'Run Helm Command',
      arguments: [this]
    }
  }
}

class HelmMessageItem extends vscode.TreeItem {
  constructor(label, description, kind) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = description
    this.contextValue = 'helmMessage'
    this.iconPath = new vscode.ThemeIcon(kind === 'error' ? 'error' : 'info')
  }
}

function activate(context) {
  const provider = new HelmTreeProvider()

  context.subscriptions.push(vscode.window.registerTreeDataProvider('helmCtrl.explorer', provider))
  context.subscriptions.push(vscode.commands.registerCommand('helmCtrl.refresh', () => provider.refresh()))
  context.subscriptions.push(vscode.commands.registerCommand('helmCtrl.openConfig', () => openConfigFile()))
  context.subscriptions.push(vscode.commands.registerCommand('helmCtrl.runCommand', item => runCommandFromItem(item)))
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()))
  context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => removeTerminalReference(terminal)))

  registerWatchers(context, provider)
}

function deactivate() {}

function registerWatchers(context, provider) {
  const patterns = ['**/helm.config.js', '**/helm.config.json', '**/.env']

  patterns.forEach(pattern => {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    context.subscriptions.push(watcher)
    context.subscriptions.push(watcher.onDidChange(() => provider.refresh()))
    context.subscriptions.push(watcher.onDidCreate(() => provider.refresh()))
    context.subscriptions.push(watcher.onDidDelete(() => provider.refresh()))
  })
}

function getPrimaryWorkspaceFolder() {
  return vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : null
}

function loadHelmConfig(basePath) {
  const jsPath = path.join(basePath, 'helm.config.js')
  const jsonPath = path.join(basePath, 'helm.config.json')

  if (fs.existsSync(jsPath)) {
    if (!vscode.workspace.isTrusted) {
      return {
        error: 'Workspace trust is required to load helm.config.js',
        detail: 'Trust the workspace or switch to helm.config.json'
      }
    }

    try {
      const config = withWorkspaceDotEnv(basePath, () => {
        const resolved = require.resolve(jsPath)
        delete require.cache[resolved]
        return require(jsPath)
      })

      return { config, source: jsPath }
    } catch (error) {
      return {
        error: 'Failed to load helm.config.js',
        detail: error.message
      }
    }
  }

  if (fs.existsSync(jsonPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      return { config, source: jsonPath }
    } catch (error) {
      return {
        error: 'Failed to parse helm.config.json',
        detail: error.message
      }
    }
  }

  return { config: null, source: null }
}

function withWorkspaceDotEnv(basePath, callback) {
  const dotEnvValues = parseEnvFile(path.join(basePath, '.env'))
  const injectedKeys = []

  Object.entries(dotEnvValues).forEach(([key, value]) => {
    if (!(key in process.env)) {
      process.env[key] = value
      injectedKeys.push(key)
    }
  })

  try {
    return callback()
  } finally {
    injectedKeys.forEach(key => {
      delete process.env[key]
    })
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  return fs.readFileSync(filePath, 'utf8').split('\n').reduce((accumulator, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return accumulator

    const separator = trimmed.indexOf('=')
    if (separator === -1) return accumulator

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    accumulator[key] = value
    return accumulator
  }, {})
}

function resolveHelmVars(configEnv = {}, basePath) {
  const file = configEnv.file || '.env'
  const fileVars = parseEnvFile(path.join(basePath, file))
  const helmVars = {}

  Object.entries(configEnv).forEach(([helmKey, definition]) => {
    if (helmKey === 'file') return
    if (!definition || typeof definition !== 'object' || !definition.env_var) return

    helmVars[helmKey] = fileVars[definition.env_var] ?? process.env[definition.env_var] ?? definition.default ?? ''
  })

  return helmVars
}

function substituteVars(command, helmVars) {
  return command
    .replace(/\{([^}]+)\}/g, (match, key) => (key in helmVars ? helmVars[key] : match))
    .replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '')
}

function normalizeSections(sections) {
  if (!Array.isArray(sections)) return []

  return sections
    .filter(section => section && typeof section === 'object')
    .map(section => ({
      name: typeof section.name === 'string' && section.name.trim() ? section.name : 'Untitled',
      commands: Array.isArray(section.commands) ? section.commands
        .filter(command => command && typeof command === 'object' && typeof command.name === 'string' && typeof command.cmd === 'string')
        .map(command => ({
          name: command.name,
          desc: typeof command.desc === 'string' ? command.desc : '',
          cmd: command.cmd,
          args: command.args
        })) : []
    }))
    .filter(section => section.commands.length > 0)
}

function buildCommandTooltip(commandDefinition, helmVars) {
  const markdown = new vscode.MarkdownString(undefined, true)
  const resolvedCommand = substituteVars(commandDefinition.cmd, helmVars)

  markdown.appendMarkdown(`**${commandDefinition.name}**`)
  if (commandDefinition.desc) {
    markdown.appendMarkdown(`\n\n${commandDefinition.desc}`)
  }
  markdown.appendCodeblock(resolvedCommand, 'sh')

  return markdown
}

async function openConfigFile() {
  const workspaceFolder = getPrimaryWorkspaceFolder()
  if (!workspaceFolder) {
    vscode.window.showInformationMessage('Open a workspace folder first.')
    return
  }

  const basePath = workspaceFolder.uri.fsPath
  const existing = CONFIG_FILES.map(file => path.join(basePath, file)).find(filePath => fs.existsSync(filePath))

  if (!existing) {
    vscode.window.showInformationMessage('No helm.config.js or helm.config.json found at the workspace root.')
    return
  }

  const document = await vscode.workspace.openTextDocument(existing)
  await vscode.window.showTextDocument(document)
}

async function runCommandFromItem(item) {
  if (!(item instanceof HelmCommandItem)) {
    vscode.window.showInformationMessage('Run commands from the Helm sidebar.')
    return
  }

  const basePath = item.workspaceFolder.uri.fsPath
  const resolvedCommand = substituteVars(item.commandDefinition.cmd, item.helmVars)

  if (resolvedCommand.trimStart().startsWith('open-url ')) {
    const url = resolvedCommand.trimStart().slice('open-url '.length).trim()
    if (!url) {
      vscode.window.showErrorMessage(`Command "${item.commandDefinition.name}" does not include a URL.`)
      return
    }

    await vscode.env.openExternal(vscode.Uri.parse(url))
    return
  }

  let extraArgs = ''
  if (item.commandDefinition.args !== false) {
    const input = await vscode.window.showInputBox({
      prompt: `Extra args for ${item.commandDefinition.name}`,
      placeHolder: '--flag value',
      ignoreFocusOut: true
    })

    if (input === undefined) return
    extraArgs = input.trim()
  }

  const terminal = getOrCreateTerminal(basePath)
  terminal.show()
  terminal.sendText([resolvedCommand, extraArgs].filter(Boolean).join(' '))
}

function getOrCreateTerminal(basePath) {
  const existing = terminalByWorkspace.get(basePath)
  if (existing && !existing.exitStatus) {
    return existing
  }

  const terminal = vscode.window.createTerminal({
    name: `Helm: ${path.basename(basePath)}`,
    cwd: basePath,
    env: {
      PATH: `${path.join(basePath, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`
    }
  })

  terminalByWorkspace.set(basePath, terminal)
  return terminal
}

function removeTerminalReference(terminal) {
  for (const [workspacePath, existing] of terminalByWorkspace.entries()) {
    if (existing === terminal) {
      terminalByWorkspace.delete(workspacePath)
      break
    }
  }
}

module.exports = {
  activate,
  deactivate
}
