const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { openUrl } = require('./open-url')

function buildIndex(sections) {
  const index = new Map()
  sections.forEach(section => {
    section.commands.forEach(cmd => index.set(cmd.name, { ...cmd, section: section.name }))
  })
  return index
}

function substituteEnv(cmd, env) {
  return cmd.replace(/\$\{([^}]+)\}/g, (_, key) => env[key] ?? process.env[key] ?? '')
}

function color(str, type) {
  const codes = { cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m' }
  return `${codes[type] ?? ''}${str}\x1b[0m`
}

function matches(cmd, filter) {
  if (!filter) return true
  const term = filter.toLowerCase()
  return cmd.name.toLowerCase().includes(term) || cmd.desc.toLowerCase().includes(term)
}

function resolveCommand(argv, index) {
  if (!argv.length) return { command: null, extraArgs: [] }
  for (let i = argv.length; i >= 1; i--) {
    const candidate = argv.slice(0, i).join(':')
    const found = index.get(candidate)
    if (found) return { command: found, extraArgs: argv.slice(i) }
  }
  return { command: null, extraArgs: argv.slice(1) }
}

function run(def, extraArgs, env) {
  const resolvedCmd = substituteEnv(def.cmd, env)

  // Handle open-url built-in
  if (resolvedCmd.trimStart().startsWith('open-url ')) {
    const url = resolvedCmd.trimStart().slice('open-url '.length).trim()
    openUrl(url)
    return
  }

  const extra = def.args === false ? [] : extraArgs
  const full = [resolvedCmd, ...extra].join(' ')
  const spawnEnv = {
    ...process.env,
    PATH: `${path.join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH}`
  }
  const child = spawn(full, { stdio: 'inherit', shell: true, env: spawnEnv })
  child.on('exit', code => process.exit(code ?? 0))
}

function showHelp(sections, filter) {
  const flat = sections.flatMap(s => s.commands)
  const maxName = Math.max(...flat.map(c => c.name.length))
  console.log('\nUsage: helm <command> [args]')
  console.log('       helm              # interactive menu')
  console.log('       helm help [filter]')
  console.log('       helm menu [filter]')
  if (filter) console.log(`Filter: ${filter}`)
  sections.forEach(section => {
    const items = section.commands.filter(c => matches(c, filter))
    if (!items.length) return
    console.log(`\n${color(section.name, 'cyan')}`)
    items.forEach(cmd => {
      const name = cmd.name.replace(':', ' ').padEnd(maxName)
      console.log(`  ${color(name, 'yellow')}  ${cmd.desc}`)
    })
  })
  console.log('')
}

async function interactiveMenu(sections, filter) {
  const flat = sections.flatMap(s => s.commands)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = prompt => new Promise(resolve => rl.question(prompt, resolve))

  try {
    const renderMenu = searchTerm => {
      const items = flat.filter(cmd => matches(cmd, searchTerm))
      if (!items.length) { console.log('No commands found.'); return { items: [] } }
      const countLabel = `${items.length} command${items.length === 1 ? '' : 's'}`
      const filterLabel = searchTerm ? `Filter: "${searchTerm}"` : 'Filter: all'
      const maxNum = String(items.length).length
      const maxCmd = Math.max(...items.map(cmd => cmd.name.replace(':', ' ').length))
      const lineWidth = Math.max(42, Math.min(process.stdout.columns || 60, 80))
      console.log(`\n${color('HELM', 'cyan')} ${color(countLabel, 'dim')}`)
      console.log(`${color(filterLabel, 'dim')}`)
      console.log(color('-'.repeat(lineWidth), 'dim'))
      items.forEach((cmd, idx) => {
        const num = String(idx + 1).padStart(maxNum)
        const name = cmd.name.replace(':', ' ').padEnd(maxCmd)
        const label = `${color('helm', 'cyan')} ${color(name, 'yellow')}`
        console.log(` ${color(num, 'green')} ${label} ${color('-', 'dim')} ${cmd.desc}`)
      })
      return { items }
    }

    let search = filter
    if (!search) search = (await ask('Filter (optional): ')).trim()
    let { items } = renderMenu(search)
    if (!items.length) return null

    while (true) {
      const pick = (await ask('\nSelect # (q to quit, s to search): ')).trim().toLowerCase()
      if (!pick || pick === 'q') return null
      if (pick === 's') {
        search = (await ask('Filter (optional): ')).trim()
        ;({ items } = renderMenu(search))
        if (!items.length) return null
        continue
      }
      const num = Number(pick)
      if (!Number.isInteger(num) || num < 1 || num > items.length) {
        console.log('Invalid selection.')
        continue
      }
      const extra = (await ask('Extra args (optional): ')).trim()
      return { command: items[num - 1], extraArgs: extra ? [extra] : [] }
    }
  } finally {
    rl.close()
  }
}

async function main(config, argv) {
  const { sections, env: configEnv = {} } = config
  const env = { ...configEnv }

  const index = buildIndex(sections)

  if (!argv.length) {
    const selection = await interactiveMenu(sections, null)
    if (!selection) process.exit(0)
    run(selection.command, selection.extraArgs, env)
    return
  }

  const menuIndex = argv.indexOf('--menu')
  const isMenu = argv[0] === 'menu' || menuIndex !== -1
  if (isMenu) {
    let filterArgs = argv.slice()
    if (filterArgs[0] === 'menu') filterArgs = filterArgs.slice(1)
    filterArgs = filterArgs.filter(arg => arg !== '--menu')
    const filter = filterArgs.join(' ').trim() || null
    const selection = await interactiveMenu(sections, filter)
    if (!selection) process.exit(0)
    run(selection.command, selection.extraArgs, env)
    return
  }

  if (['help', '--help', '-h'].includes(argv[0])) {
    const filter = argv.slice(1).join(' ').trim() || null
    showHelp(sections, filter)
    process.exit(0)
  }

  const { command, extraArgs } = resolveCommand(argv, index)
  if (!command) {
    showHelp(sections, argv[0])
    process.exit(0)
  }

  run(command, extraArgs, env)
}

module.exports = { main }
