const { execFileSync } = require('child_process')
const path = require('path')
const electronExe = path.join(__dirname, '..', 'Electron', 'node_modules', 'electron', 'dist', 'electron.exe')
execFileSync(electronExe, ['.'], { stdio: 'inherit', cwd: __dirname })
