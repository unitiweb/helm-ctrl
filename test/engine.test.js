const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  parseEnvFile,
  resolveHelmVars,
  substituteVars,
  matches,
  resolveCommand,
  buildIndex,
  expandCmdRefs
} = require('../lib/engine')

// ---------------------------------------------------------------------------
// parseEnvFile
// ---------------------------------------------------------------------------

describe('parseEnvFile', () => {
  let tmpDir

  before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-test-')) })
  after(() => { fs.rmSync(tmpDir, { recursive: true }) })

  const write = (name, content) => {
    const file = path.join(tmpDir, name)
    fs.writeFileSync(file, content)
    return file
  }

  it('returns {} for a non-existent file', () => {
    const result = parseEnvFile(path.join(tmpDir, 'missing.env'))
    assert.deepEqual(result, {})
  })

  it('parses simple KEY=value pairs', () => {
    const file = write('simple.env', 'FOO=bar\nBAZ=qux\n')
    assert.deepEqual(parseEnvFile(file), { FOO: 'bar', BAZ: 'qux' })
  })

  it('strips double quotes from values', () => {
    const file = write('double.env', 'PORT="8080"\n')
    assert.deepEqual(parseEnvFile(file), { PORT: '8080' })
  })

  it('strips single quotes from values', () => {
    const file = write('single.env', "PORT='8080'\n")
    assert.deepEqual(parseEnvFile(file), { PORT: '8080' })
  })

  it('ignores comment lines', () => {
    const file = write('comments.env', '# this is a comment\nFOO=bar\n')
    assert.deepEqual(parseEnvFile(file), { FOO: 'bar' })
  })

  it('ignores blank lines', () => {
    const file = write('blanks.env', '\nFOO=bar\n\nBAZ=qux\n')
    assert.deepEqual(parseEnvFile(file), { FOO: 'bar', BAZ: 'qux' })
  })

  it('handles values that contain = characters', () => {
    const file = write('equals.env', 'URL=http://x.com?a=1&b=2\n')
    assert.deepEqual(parseEnvFile(file), { URL: 'http://x.com?a=1&b=2' })
  })

  it('ignores lines with no = character', () => {
    const file = write('noeq.env', 'INVALID\nFOO=bar\n')
    assert.deepEqual(parseEnvFile(file), { FOO: 'bar' })
  })
})

// ---------------------------------------------------------------------------
// resolveHelmVars
// ---------------------------------------------------------------------------

describe('resolveHelmVars', () => {
  let tmpDir
  const origEnv = { ...process.env }

  before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-test-')) })
  after(() => {
    fs.rmSync(tmpDir, { recursive: true })
    // Restore process.env
    Object.keys(process.env).forEach(k => { if (!(k in origEnv)) delete process.env[k] })
    Object.assign(process.env, origEnv)
  })

  const writeEnv = (content) => {
    fs.writeFileSync(path.join(tmpDir, '.env'), content)
  }

  it('returns {} for empty configEnv', () => {
    assert.deepEqual(resolveHelmVars({}, tmpDir), {})
  })

  it('resolves value from env file', () => {
    writeEnv('API_PORT=9000\n')
    const result = resolveHelmVars({
      HELM_API_PORT: { env_var: 'API_PORT', default: '3000' }
    }, tmpDir)
    assert.equal(result.HELM_API_PORT, '9000')
  })

  it('falls back to default when env var is not in file or process.env', () => {
    writeEnv('')
    delete process.env.API_PORT
    const result = resolveHelmVars({
      HELM_API_PORT: { env_var: 'API_PORT', default: '3000' }
    }, tmpDir)
    assert.equal(result.HELM_API_PORT, '3000')
  })

  it('falls back to process.env when var is not in file', () => {
    writeEnv('')
    process.env.API_PORT = '7777'
    const result = resolveHelmVars({
      HELM_API_PORT: { env_var: 'API_PORT', default: '3000' }
    }, tmpDir)
    assert.equal(result.HELM_API_PORT, '7777')
    delete process.env.API_PORT
  })

  it('env file takes priority over process.env', () => {
    writeEnv('API_PORT=9000\n')
    process.env.API_PORT = '7777'
    const result = resolveHelmVars({
      HELM_API_PORT: { env_var: 'API_PORT', default: '3000' }
    }, tmpDir)
    assert.equal(result.HELM_API_PORT, '9000')
    delete process.env.API_PORT
  })

  it('skips the file key', () => {
    writeEnv('')
    const result = resolveHelmVars({ file: '.env' }, tmpDir)
    assert.equal('file' in result, false)
  })

  it('skips entries without env_var', () => {
    writeEnv('')
    const result = resolveHelmVars({ HELM_X: { default: 'abc' } }, tmpDir)
    assert.equal('HELM_X' in result, false)
  })

  it('uses a custom env file specified by file key', () => {
    fs.writeFileSync(path.join(tmpDir, 'staging.env'), 'API_PORT=5000\n')
    const result = resolveHelmVars({
      file: 'staging.env',
      HELM_API_PORT: { env_var: 'API_PORT', default: '3000' }
    }, tmpDir)
    assert.equal(result.HELM_API_PORT, '5000')
  })

  it('returns empty string when no file, no process.env, no default', () => {
    writeEnv('')
    delete process.env.API_PORT
    const result = resolveHelmVars({
      HELM_API_PORT: { env_var: 'API_PORT' }
    }, tmpDir)
    assert.equal(result.HELM_API_PORT, '')
  })
})

// ---------------------------------------------------------------------------
// substituteVars
// ---------------------------------------------------------------------------

describe('substituteVars', () => {
  const origEnv = { ...process.env }
  after(() => {
    Object.keys(process.env).forEach(k => { if (!(k in origEnv)) delete process.env[k] })
    Object.assign(process.env, origEnv)
  })

  it('replaces {HELM_VAR} placeholders', () => {
    const result = substituteVars('open-url http://localhost:{HELM_PORT}', { HELM_PORT: '8080' })
    assert.equal(result, 'open-url http://localhost:8080')
  })

  it('leaves {UNKNOWN} unchanged when key not in helmVars', () => {
    const result = substituteVars('cmd {NOT_DEFINED}', {})
    assert.equal(result, 'cmd {NOT_DEFINED}')
  })

  it('replaces ${ENV_VAR} from process.env', () => {
    process.env.MY_VAR = 'hello'
    const result = substituteVars('echo ${MY_VAR}', {})
    assert.equal(result, 'echo hello')
    delete process.env.MY_VAR
  })

  it('replaces ${ENV_VAR} with empty string when not set', () => {
    delete process.env.MISSING_VAR
    const result = substituteVars('echo ${MISSING_VAR}', {})
    assert.equal(result, 'echo ')
  })

  it('handles both {HELM_VAR} and ${ENV_VAR} in same string', () => {
    process.env.SYS_VAR = 'world'
    const result = substituteVars('{HELM_X} ${SYS_VAR}', { HELM_X: 'hello' })
    assert.equal(result, 'hello world')
    delete process.env.SYS_VAR
  })

  it('replaces multiple occurrences', () => {
    const result = substituteVars('{PORT}/{PORT}', { PORT: '8080' })
    assert.equal(result, '8080/8080')
  })
})

// ---------------------------------------------------------------------------
// matches
// ---------------------------------------------------------------------------

describe('matches', () => {
  const cmd = { name: 'migrate:rollback', desc: 'Rollback the last migration' }

  it('returns true when filter is null', () => {
    assert.equal(matches(cmd, null), true)
  })

  it('returns true when filter is empty string', () => {
    assert.equal(matches(cmd, ''), true)
  })

  it('matches on command name', () => {
    assert.equal(matches(cmd, 'migrate'), true)
  })

  it('matches on description', () => {
    assert.equal(matches(cmd, 'rollback'), true)
  })

  it('is case insensitive', () => {
    assert.equal(matches(cmd, 'MIGRATE'), true)
    assert.equal(matches(cmd, 'ROLLBACK'), true)
  })

  it('returns false when no match', () => {
    assert.equal(matches(cmd, 'ios'), false)
  })

  it('matches partial strings', () => {
    assert.equal(matches(cmd, 'roll'), true)
    assert.equal(matches(cmd, 'igrat'), true)
  })
})

// ---------------------------------------------------------------------------
// resolveCommand
// ---------------------------------------------------------------------------

describe('resolveCommand', () => {
  const sections = [
    {
      name: 'Database',
      commands: [
        { name: 'migrate', desc: 'Run migrations', cmd: 'artisan migrate' },
        { name: 'migrate:rollback', desc: 'Rollback', cmd: 'artisan migrate:rollback' },
        { name: 'migrate:make', desc: 'Make migration', cmd: 'artisan make:migration' }
      ]
    },
    {
      name: 'Core',
      commands: [
        { name: 'up', desc: 'Start services', cmd: 'docker compose up' }
      ]
    }
  ]
  const index = buildIndex(sections)

  it('returns null command for empty argv', () => {
    const { command, extraArgs } = resolveCommand([], index)
    assert.equal(command, null)
    assert.deepEqual(extraArgs, [])
  })

  it('resolves a simple command', () => {
    const { command, extraArgs } = resolveCommand(['migrate'], index)
    assert.equal(command.name, 'migrate')
    assert.deepEqual(extraArgs, [])
  })

  it('resolves a colon-namespaced command from space-separated args', () => {
    const { command, extraArgs } = resolveCommand(['migrate', 'rollback'], index)
    assert.equal(command.name, 'migrate:rollback')
    assert.deepEqual(extraArgs, [])
  })

  it('resolves a colon-namespaced command passed as a single arg', () => {
    const { command, extraArgs } = resolveCommand(['migrate:rollback'], index)
    assert.equal(command.name, 'migrate:rollback')
    assert.deepEqual(extraArgs, [])
  })

  it('captures extra args after the command', () => {
    const { command, extraArgs } = resolveCommand(['migrate', '--force'], index)
    assert.equal(command.name, 'migrate')
    assert.deepEqual(extraArgs, ['--force'])
  })

  it('captures extra args after a namespaced command', () => {
    const { command, extraArgs } = resolveCommand(['migrate', 'rollback', '--step=2'], index)
    assert.equal(command.name, 'migrate:rollback')
    assert.deepEqual(extraArgs, ['--step=2'])
  })

  it('returns null for an unknown command', () => {
    const { command } = resolveCommand(['unknown'], index)
    assert.equal(command, null)
  })

  it('prefers the longest matching command', () => {
    const { command } = resolveCommand(['migrate', 'make'], index)
    assert.equal(command.name, 'migrate:make')
  })
})

// ---------------------------------------------------------------------------
// expandCmdRefs
// ---------------------------------------------------------------------------

describe('expandCmdRefs', () => {
  const sections = [
    {
      name: 'Core',
      commands: [
        { name: 'sail', desc: 'Sail CLI', cmd: 'vendor/bin/sail' },
        { name: 'artisan', desc: 'Artisan CLI', cmd: 'sail artisan' }
      ]
    },
    {
      name: 'Database',
      commands: [
        { name: 'db:migrate', desc: 'Run migrations', cmd: 'artisan migrate' }
      ]
    }
  ]
  const index = buildIndex(sections)

  it('returns cmd unchanged when first word is not a command', () => {
    assert.equal(expandCmdRefs('vendor/bin/sail up', index), 'vendor/bin/sail up')
  })

  it('expands a single-level reference with trailing args', () => {
    assert.equal(expandCmdRefs('sail up', index), 'vendor/bin/sail up')
  })

  it('expands a reference with no trailing args', () => {
    assert.equal(expandCmdRefs('sail', index), 'vendor/bin/sail')
  })

  it('expands nested references', () => {
    assert.equal(expandCmdRefs('artisan migrate', index), 'vendor/bin/sail artisan migrate')
  })

  it('expands deeply nested references (db:migrate → artisan → sail)', () => {
    assert.equal(expandCmdRefs('db:migrate', index), 'vendor/bin/sail artisan migrate')
  })

  it('throws on circular references', () => {
    const circular = buildIndex([{
      name: 'circular',
      commands: [
        { name: 'a', desc: '', cmd: 'b x' },
        { name: 'b', desc: '', cmd: 'a x' }
      ]
    }])
    assert.throws(() => expandCmdRefs('a', circular), /[Cc]ircular/)
  })
})

// ---------------------------------------------------------------------------
// buildIndex
// ---------------------------------------------------------------------------

describe('buildIndex', () => {
  const sections = [
    {
      name: 'Core',
      commands: [
        { name: 'up', desc: 'Start', cmd: 'docker compose up' },
        { name: 'down', desc: 'Stop', cmd: 'docker compose down' }
      ]
    },
    {
      name: 'Database',
      commands: [
        { name: 'migrate', desc: 'Migrate', cmd: 'artisan migrate' }
      ]
    }
  ]

  it('builds a Map with command names as keys', () => {
    const index = buildIndex(sections)
    assert.ok(index instanceof Map)
    assert.equal(index.size, 3)
    assert.ok(index.has('up'))
    assert.ok(index.has('down'))
    assert.ok(index.has('migrate'))
  })

  it('attaches the section name to each command', () => {
    const index = buildIndex(sections)
    assert.equal(index.get('up').section, 'Core')
    assert.equal(index.get('migrate').section, 'Database')
  })

  it('preserves all original command fields', () => {
    const index = buildIndex(sections)
    const up = index.get('up')
    assert.equal(up.name, 'up')
    assert.equal(up.desc, 'Start')
    assert.equal(up.cmd, 'docker compose up')
  })
})
