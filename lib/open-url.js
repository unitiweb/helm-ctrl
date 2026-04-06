const { spawn } = require('child_process')

function openUrl(url) {
  const cmd =
    process.platform === 'win32' ? 'start' :
    process.platform === 'darwin' ? 'open' :
    'xdg-open'
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref()
}

module.exports = { openUrl }
