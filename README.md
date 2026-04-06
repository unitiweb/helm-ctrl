# helm-ctrl

A config-driven interactive CLI task runner. Define your project's commands once in a config file and run them from that project directory with a clean menu, fuzzy filtering, and built-in URL opening.

## Requirements

- Node.js 14 or newer
- A `helm.config.js` or `helm.config.json` file in the current working directory

---

## Installation

### Global (recommended)

Installs the `helm` command system-wide so you can run it directly in any project that has a Helm config file:

```bash
npm install -g helm-ctrl
```

```bash
cd your-project
helm              # opens interactive menu
helm help
helm build
```

### Per-project

Install as a dev dependency if you want helm-ctrl pinned to the project and available to all contributors via `npm install`:

```bash
npm install helm-ctrl --save-dev
```

Because it's not a global install, the `helm` command won't be on your PATH. Use it via npm scripts instead. Add this to your `package.json`:

```json
"scripts": {
  "helm": "helm"
}
```

Then run it with:

```bash
npm run helm              # opens interactive menu
npm run helm -- help      # pass arguments with --
npm run helm -- build
```

### Both (best of both worlds)

Install globally for your own convenience, and also as a dev dependency so teammates get it automatically:

```bash
npm install -g helm-ctrl
npm install helm-ctrl --save-dev
```

---

## Development

```bash
npm install
npm run lint
npm test
npm run check
```

`npm run check` is the same standards gate used in CI, so local and CI validation stay aligned.

---

## Config File

helm-ctrl looks for a config file in the current working directory only. It tries `helm.config.js` first, then `helm.config.json`.

If both files exist, `helm.config.js` wins.

### When to use each

| Format | Use when |
|--------|----------|
| `helm.config.js` | You need dynamic values — env vars, computed ports, imported helpers |
| `helm.config.json` | Commands are all static strings, no runtime logic needed |

### Shape

Both formats share the same structure: a `sections` array where each section has a `name` and a list of `commands`.

```ts
{
  config?: {
    env?: {
      file?: string,        // path to env file, defaults to ".env"
      [HELM_VAR]: {
        env_var: string,    // the variable name to read from the env file
        desc?: string,      // optional description
        default?: string    // fallback if the env var is not set
      }
    }
  },
  sections: [
    {
      name: string,
      commands: [
        {
          name: string,   // the command key, used to invoke it
          desc: string,   // shown in help and menu
          cmd: string,    // the shell command to run
          args?: false    // optional: set to false to block extra CLI args
        }
      ]
    }
  ]
}
```

---

## config.env — Variable Mapping

The optional `config.env` block lets you map env file variables to named placeholders used in `cmd` strings. This works in both JS and JSON configs.

```json
{
  "config": {
    "env": {
      "file": ".env",
      "HELM_API_PORT": {
        "env_var": "API_PORT",
        "desc": "Port for the API service",
        "default": "3000"
      },
      "HELM_DB_PORT": {
        "env_var": "DB_PORT",
        "desc": "Port for the database manager",
        "default": "8016"
      }
    }
  }
}
```

Then use `{HELM_VAR}` placeholders in any `cmd` string:

```json
{ "name": "open:api", "desc": "Open API in browser", "cmd": "open-url http://localhost:{HELM_API_PORT}" }
```

**Resolution order** for each variable:
1. The env file (`.env` by default, or whatever `file` points to)
2. `process.env` (shell-exported variables)
3. `default` value in the config

That precedence is specific to `config.env`. If a value exists in both the env file and `process.env`, the env file wins.

Separate from that, helm-ctrl also preloads `.env` into `process.env` before loading `helm.config.js`, but it does not overwrite variables that were already exported in the shell. That matters only if your JS config reads `process.env` directly.

### Direct `${ENV_VAR}` placeholders

You can also use shell-style `${ENV_VAR}` placeholders directly in any `cmd` string:

```json
{ "name": "echo:port", "desc": "Print API port", "cmd": "echo ${API_PORT}" }
```

This is most useful in JSON configs when you want simple `process.env` substitution without defining a `config.env` mapping.

---

## JS Config (`helm.config.js`)

For most projects with a `.env` file, use `config.env` in a JSON config and skip the JS config entirely. Use a JS config only when you need genuine runtime logic: conditional commands, imports, or computed values beyond simple env lookups.

Because helm-ctrl preloads `.env` before `helm.config.js` runs, `process.env` is already populated inside the JS config.

```js
// helm.config.js
module.exports = {
  config: {
    env: {
      file: '.env',
      HELM_API_PORT: { env_var: 'API_PORT', default: '8011' },
      HELM_DB_PORT:  { env_var: 'DB_PORT',  default: '8016' },
    }
  },
  sections: [
    {
      name: 'Core',
      commands: [
        { name: 'up',   desc: 'Start services', cmd: 'docker compose up -d' },
        { name: 'down', desc: 'Stop services',  cmd: 'docker compose down' },
      ]
    },
    {
      name: 'Open',
      commands: [
        { name: 'open:api', desc: 'Open API in browser', cmd: 'open-url http://localhost:{HELM_API_PORT}' },
        { name: 'open:db',  desc: 'Open DB manager',     cmd: 'open-url http://localhost:{HELM_DB_PORT}' },
      ]
    }
  ]
}
```

---

## JSON Config (`helm.config.json`)

JSON configs support the full `config.env` variable mapping, making dynamic values like port numbers work without any JS.

```json
{
  "config": {
    "env": {
      "file": ".env",
      "HELM_API_PORT": { "env_var": "API_PORT", "default": "8011" },
      "HELM_DB_PORT":  { "env_var": "DB_PORT",  "default": "8016" }
    }
  },
  "sections": [
    {
      "name": "Core",
      "commands": [
        { "name": "up",   "desc": "Start services", "cmd": "docker compose up -d" },
        { "name": "down", "desc": "Stop services",  "cmd": "docker compose down" }
      ]
    },
    {
      "name": "Open",
      "commands": [
        { "name": "open:api", "desc": "Open API in browser", "cmd": "open-url http://localhost:{HELM_API_PORT}" },
        { "name": "open:db",  "desc": "Open DB manager",     "cmd": "open-url http://localhost:{HELM_DB_PORT}" }
      ]
    }
  ]
}
```

---

## Running Commands

All command execution happens relative to the current working directory, and all CLI entrypoints require a config file there.

### Direct invocation

```bash
helm <command>
```

Command names use `:` as a separator, but you can also use spaces:

```bash
helm migrate:rollback
helm migrate rollback   # same thing
```

### Passing extra arguments

Any arguments after the command name are appended to the shell command:

```bash
helm artisan make:model Post
# runs: docker compose exec laravel php artisan make:model Post
```

The same applies to namespaced commands:

```bash
helm migrate rollback --step=2
# resolves command: migrate:rollback
# appends: --step=2
```

To prevent extra args from being forwarded, set `args: false` on the command definition:

```js
{ name: 'build', desc: 'Build the app', cmd: 'docker compose build', args: false }
```

---

## Interactive Menu

Running `helm` with no arguments opens the interactive menu.

```
Filter (optional): ios

HELM  7 commands
Filter: "ios"
----------------------------------------
 1 helm ios                    - Build iOS (local)
 2 helm ios watch              - Build iOS with watch (local)
 3 helm ios staging            - Build iOS (staging)
 4 helm ios production         - Build iOS (production)
 5 helm ios generate:assets    - Generate iOS assets for local
 ...

Select # (q to quit, s to search):
```

You can also open the menu with a pre-applied filter:

```bash
helm menu ios
helm --menu ios        # same
```

At the selection prompt:
- Enter a number to select a command
- `s` to search/re-filter
- `q` to quit

After selecting, you'll be prompted for optional extra args before the command runs.

---

## Help

```bash
helm help             # list all commands grouped by section
helm help ios         # filter to commands matching "ios"
helm --help
helm -h
```

The filter matches against both the command name and its description, so `helm help browser` would surface any command with "browser" in its `desc`.

Note: help still requires a config file in the current directory. If no config file is present, helm-ctrl exits before rendering help.

---

## open-url

`open-url` is a built-in command prefix for opening URLs in the default browser. It works cross-platform with no extra dependencies.

Use it in any `cmd` string instead of `open-cli` or similar tools:

```js
{ name: 'open:app', desc: 'Open app in browser', cmd: 'open-url http://localhost:8010' }
```

Platform behavior:

| OS | Command used |
|----|-------------|
| macOS | `open` |
| Linux | `xdg-open` |
| Windows | `start` |

The process is detached and non-blocking — helm-ctrl hands off the URL and exits cleanly without waiting for the browser.

---

## Filtering

Filtering works the same way across the menu, help, and menu pre-filter. A command is included if the filter term appears in either its `name` or `desc` (case-insensitive).

```bash
helm help cache        # shows all commands with "cache" in name or description
helm menu docker       # opens menu filtered to docker-related commands
```

---

## Command Name Conventions

Command names support `:` as a namespace separator. This keeps the help output organized and allows space-separated invocation:

```
migrate          → helm migrate
migrate:rollback → helm migrate rollback  (or helm migrate:rollback)
migrate:make     → helm migrate make
```

Sections in the config are purely for visual grouping in help output — they have no effect on how commands are invoked.

---

## Example Project Structure

```
my-project/
  helm.config.js     ← config file (or helm.config.json)
  .env               ← optional, used by config.env and JS config preload
  package.json
  ...
```

No changes to `package.json` are required. helm-ctrl automatically prepends `./node_modules/.bin` to `PATH` when running commands, so locally installed binaries work without `npx`.
