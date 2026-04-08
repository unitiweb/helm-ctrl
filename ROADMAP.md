# Roadmap

Planned features for helm-ctrl.

---

## Description on Run

When a command runs, its `desc` is printed as a header line before the command executes. Gives immediate visual confirmation of what's running, especially useful when invoking from the interactive menu or running sequences.

```
$ helm db:migrate

Migrate the database
> php artisan migrate

  Migrating: 2024_01_10_create_users_table
  Migrated:  2024_01_10_create_users_table

✓ db:migrate
```

Enabled globally in config or toggled per command:

```js
export default {
  config: {
    showDesc: true           // enable for all commands
  },
  sections: [
    {
      name: 'Database',
      commands: [
        { name: 'db:migrate', desc: 'Migrate the database',  cmd: 'php artisan migrate' },
        { name: 'db:fresh',   desc: 'Wipe and re-migrate',   cmd: 'php artisan migrate:fresh', showDesc: false }  // opt out
      ]
    }
  ]
}
```

For sequences, each step's description is printed before that step runs:

```
$ helm ci

Lint source files
> eslint src/

Build for production
> vite build ...
```

---

## Command Sequences / Pipelines

Run multiple commands in order from a single definition. Useful for workflows that always go together — build then test, migrate then seed, lint then deploy.

```js
// helm.config.js
{
  name: 'ci',
  desc: 'Lint, test, and build',
  sequence: ['lint', 'test', 'build']
}
```

By default the sequence stops if any command exits non-zero. An opt-out flag lets all steps run regardless:

```js
{
  name: 'clean-all',
  desc: 'Remove all generated artifacts (best effort)',
  sequence: ['clean:dist', 'clean:cache', 'clean:coverage'],
  stopOnError: false
}
```

Each step prints its name as a header before running, so output stays readable:

```
$ helm ci

[lint]
> eslint src/

[test]
> node --test
✓ 42 tests passed

[build]
> vite build ...

✓ ci complete (18.4s)
```

Referenced commands are expanded exactly as they would be if run individually — variable substitution and `expandCmdRefs` both apply.

---

## helm init

Scaffolds a starter `helm.config.js` in the current directory. Detects common project signals and pre-populates relevant sections.

```
$ helm init
```

Detection targets:

| Signal | Generated section |
|---|---|
| `package.json` scripts | `Dev` section with `start`, `build`, `test` entries |
| `docker-compose.yml` | `Docker` section with `up`, `down`, `logs` |
| `.env.example` | `config.env` block with vars from the example file |
| Laravel / Artisan | `Artisan` section with `migrate`, `tinker`, etc. |

If nothing is detected, generates a minimal documented template:

```js
// helm.config.js
export default {
  config: {
    env: {
      // EXAMPLE_VAR: { env_var: 'EXAMPLE_VAR', desc: 'Example variable', default: 'value' }
    }
  },
  sections: [
    {
      name: 'Dev',
      commands: [
        { name: 'start', desc: 'Start dev server', cmd: 'npm run dev' }
      ]
    }
  ]
}
```

Exits with an error if `helm.config.js` already exists (no silent overwrites).

---

## helm add

Interactive wizard that appends a new command to the existing config. Avoids manually editing the config file for quick additions.

```
$ helm add

Section (existing or new): Docker
Command name: logs
Description: Tail container logs
Command: docker compose logs -f {service}
Add a parameter for {service}? (y/n): y
  Parameter name: service
  Description: Container name
  Default (optional): app

✓ Command added to helm.config.js
```

The resulting entry written to config:

```js
{
  name: 'logs',
  desc: 'Tail container logs',
  cmd: 'docker compose logs -f {service}',
  params: [
    { name: 'service', desc: 'Container name', default: 'app' }
  ]
}
```

If the named section already exists the command is appended to it. If not, a new section is created. The config file is updated in place with formatting preserved.

---

## helm check

Validates the config without running anything. Useful in CI or as a pre-commit hook.

```
$ helm check
```

Checks performed:

- **Config file loads** without syntax errors
- **Circular command references** (e.g. `a → b → a`)
- **Broken command references** — `cmd` strings that reference a command name that doesn't exist in the index
- **Missing HELM_VAR defaults** — vars with no default and no matching key in the env file
- **Duplicate command names** across sections
- **Undefined `{param}` placeholders** — placeholders in `cmd` that have no matching entry in `params`

Output:

```
$ helm check
✓ Config loaded
✓ 3 sections, 12 commands
⚠ db:rollback references unknown command "artisan" — did you mean to define it?
✗ deploy:prod → deploy:staging → deploy:prod (circular reference)

2 issues found.
```

Exits 0 if clean, non-zero if any errors are found (warnings do not affect exit code).

---

## helm watch

Re-runs a command automatically whenever files matching a glob pattern change. Built on `fs.watch` — no new dependencies.

```
$ helm watch build
$ helm watch test --glob 'src/**/*.js'
```

Config-level default globs can be set per command:

```js
{
  name: 'test',
  desc: 'Run tests',
  cmd: 'node --test',
  watch: 'src/**/*.{js,ts}'   // used when no --glob flag is provided
}
```

Behavior:

- Debounces rapid file saves (300ms default) so a save-all doesn't trigger multiple runs
- Prints a separator line with a timestamp between runs for readability
- `q` + Enter exits watch mode
- Exit code of the watched command is shown but does not exit the watcher

```
$ helm watch test

[10:42:01] starting...
> node --test
✓ 14 passed

[10:42:18] src/engine.js changed — rerunning...
> node --test
✗ 1 failed

[10:42:31] src/engine.js changed — rerunning...
> node --test
✓ 14 passed
```

---

## Dry-run Mode

Prints the fully resolved command string without executing it. Useful for debugging variable substitution, command reference expansion, and parameter values before a real run.

```
$ helm --dry-run db:migrate
```

Output shows every resolution step:

```
$ helm --dry-run db:migrate

  command : db:migrate
  expanded: artisan migrate
  resolved: vendor/bin/sail artisan migrate
  final   : DB_HOST=localhost vendor/bin/sail artisan migrate --force

(dry run — not executed)
```

Works for sequences too — each step is resolved and printed in order without any being executed.

---

## Timing Output

Prints how long a command took after it finishes. Enabled globally in config or overridden per command.

**Config:**

```js
// helm.config.js
export default {
  config: {
    timing: true          // enable for all commands
  },
  sections: [
    {
      name: 'Build',
      commands: [
        { name: 'build', desc: 'Production build', cmd: 'npm run build' },
        { name: 'lint',  desc: 'Lint source files', cmd: 'eslint src/', timing: false }  // opt out
      ]
    }
  ]
}
```

**Output:**

```
$ helm build

> vite build ...

✓ build  (4.2s)
```

On failure, the time and exit code are still shown:

```
$ helm build

> vite build ...

✗ build  (1.1s)  exit 1
```

For sequences, each step is timed individually and a total is shown at the end:

```
[lint]    ✓ (2.1s)
[test]    ✓ (11.3s)
[build]   ✓ (4.2s)

✓ ci complete  (17.6s total)
```

Implementation uses `Date.now()` around the `spawn` close event — no new dependencies.

---

## Parameterized Commands

Named placeholders in `cmd` strings that helm can prompt for interactively if not provided on the CLI. An upgrade over the current raw extra-args approach — each param gets its own label, default, and position.

**Config:**

```js
// helm.config.js
{
  name: 'checkout',
  desc: 'Switch to a branch',
  cmd: 'git checkout {branch}',
  params: [
    { name: 'branch', desc: 'Branch name', default: 'main' }
  ]
}
```

```js
{
  name: 'db:seed',
  desc: 'Seed a specific table',
  cmd: 'php artisan db:seed --class={seeder} --env={environment}',
  params: [
    { name: 'seeder',      desc: 'Seeder class name' },
    { name: 'environment', desc: 'Target environment', default: 'local' }
  ]
}
```

**CLI — positional args fill params in order:**

```
$ helm checkout feature/auth
# runs: git checkout feature/auth

$ helm db:seed UserSeeder staging
# runs: php artisan db:seed --class=UserSeeder --env=staging
```

**Interactive — missing params are prompted:**

```
$ helm checkout
Branch name (default: main): feature/auth
# runs: git checkout feature/auth

$ helm db:seed
Seeder class name: UserSeeder
Target environment (default: local):
# runs: php artisan db:seed --class=UserSeeder --env=local
```

**From the interactive menu** (`helm`), selecting a parameterized command prompts for each missing param before running — same flow, triggered from the menu.

Params compose with `{HELM_VAR}` and `${ENV_VAR}` — all three placeholder types can coexist in a single `cmd` string and are resolved in order.
