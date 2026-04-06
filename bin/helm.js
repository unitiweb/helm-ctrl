#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const { main, loadDotEnv } = require('../lib/engine')

// Load .env before requiring the config so process.env is populated
// when helm.config.js runs (e.g. for port lookups via process.env)
loadDotEnv()

function loadConfig() {
  const cwd = process.cwd()

  const jsConfig = path.join(cwd, 'helm.config.js')
  if (fs.existsSync(jsConfig)) return require(jsConfig)

  const jsonConfig = path.join(cwd, 'helm.config.json')
  if (fs.existsSync(jsonConfig)) {
    try {
      return JSON.parse(fs.readFileSync(jsonConfig, 'utf8'))
    } catch (e) {
      console.error('Failed to parse helm.config.json:', e.message)
      process.exit(1)
    }
  }

  console.error('No helm.config.js or helm.config.json found in', cwd)
  process.exit(1)
}

const config = loadConfig()
main(config, process.argv.slice(2)).catch(err => {
  console.error(err)
  process.exit(1)
})
