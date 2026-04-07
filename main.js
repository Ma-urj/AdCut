const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')
const { execFile, execFileSync, spawn } = require('child_process')

// ── FFmpeg detection ──────────────────────────────────────────────────────────
let ffmpegPath = null
try {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const out  = execFileSync(cmd, ['ffmpeg'], { encoding: 'utf8' }).trim()
  ffmpegPath = out.split('\n')[0].trim() || null
} catch (_) {}
if (!ffmpegPath) {
  try { ffmpegPath = require('ffmpeg-static') } catch (_) {}
}
function ffprobeFor(p) {
  if (!p) return 'ffprobe'
  if (/ffmpeg(\.exe)?$/i.test(p)) return p.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
  return 'ffprobe'
}
function probeVideo(filePath, logPath) {
  try {
    const out = execFileSync(
      ffprobeFor(ffmpegPath),
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', filePath],
      { encoding: 'utf8', timeout: 8000 }
    ).trim()
    const parts = out.split('x').map(n => parseInt(n, 10))
    const width = parts[0] || 0
    const height = parts[1] || 0
    if (width > 0 && height > 0) return { width, height }
  } catch (err) {
    try { fs.appendFileSync(logPath, `\n[warn] ffprobe failed for ${filePath}: ${err.message}\n`, 'utf8') } catch (_) {}
  }
  return null
}

// ── Python detection ──────────────────────────────────────────────────────────
let pythonPath = null
const pythonCandidates = [
  path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe'),
  path.join(__dirname, '..', 'venv', 'bin', 'python3'),
  path.join(__dirname, '..', 'venv', 'bin', 'python'),
  'python3', 'python',
]
for (const p of pythonCandidates) {
  try {
    execFileSync(p, ['--version'], { timeout: 3000 })
    pythonPath = p
    break
  } catch (_) {}
}

// ── App state ─────────────────────────────────────────────────────────────────
let mainWindow    = null
let activeProject = null  // { path: string, dir: string }

const RECENT_FILE    = path.join(os.homedir(), '.ve-recent.json')
const SETTINGS_FILE  = path.join(os.homedir(), '.ve-settings.json')
const exportTmpBase = path.join(os.tmpdir(), `ve-export-${Date.now()}`)

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 900, minHeight: 640,
    backgroundColor: '#1a1a1a',
    title: 'Video Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  try { fs.rmSync(exportTmpBase, { recursive: true, force: true }) } catch (_) {}
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Recent projects ───────────────────────────────────────────────────────────
function readRecent() {
  try { return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')) } catch (_) { return [] }
}
function addRecent(projectPath) {
  let list = readRecent().filter(p => p !== projectPath)
  list.unshift(projectPath)
  list = list.slice(0, 10)
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(list), 'utf8') } catch (_) {}
}

ipcMain.handle('get-recent-projects', () => {
  return readRecent().filter(p => {
    try { return fs.existsSync(p) } catch (_) { return false }
  })
})

// ── Project management ────────────────────────────────────────────────────────
ipcMain.handle('pick-project-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Project Folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('pick-project-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project',
    filters: [{ name: 'Video Editor Project', extensions: ['vep'] }],
    properties: ['openFile'],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('create-project', (_, { folderPath, name }) => {
  const projectFile = path.join(folderPath, `${sanitizeName(name)}.vep`)
  const workingDir  = path.join(folderPath, 'working')
  fs.mkdirSync(workingDir, { recursive: true })

  const data = {
    version: 1,
    name,
    created:  new Date().toISOString(),
    modified: new Date().toISOString(),
    media:    [],
    tracks:   [{ id: 'track-0', name: 'Video 1', clips: [] }],
    products: [],
    zoom: 80,
    playhead: 0,
  }
  fs.writeFileSync(projectFile, JSON.stringify(data, null, 2), 'utf8')
  activeProject = { path: projectFile, dir: folderPath }
  addRecent(projectFile)
  return { projectFile, data }
})

ipcMain.handle('open-project', (_, projectFile) => {
  const data = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  activeProject = { path: projectFile, dir: path.dirname(projectFile) }
  addRecent(projectFile)
  return { projectFile, data }
})

ipcMain.handle('save-project', (_, { projectFile, data }) => {
  data.modified = new Date().toISOString()
  fs.writeFileSync(projectFile, JSON.stringify(data, null, 2), 'utf8')
  return true
})

ipcMain.handle('get-active-project', () => activeProject)

// ── Import media → MKV working copy ──────────────────────────────────────────
ipcMain.handle('open-files', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'] }],
  })
  return canceled ? [] : filePaths
})

ipcMain.handle('import-to-mkv', async (_, { sourcePath, mediaId }) => {
  const projectDir = activeProject?.dir || os.tmpdir()
  const workingDir = path.join(projectDir, 'working')
  fs.mkdirSync(workingDir, { recursive: true })
  const mkvPath = path.join(workingDir, `${mediaId}.mkv`)

  if (!ffmpegPath) {
    return { success: true, mkvPath: sourcePath, url: pathToUrl(sourcePath), native: true }
  }
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-i', sourcePath, '-c', 'copy', '-y', mkvPath],
      { maxBuffer: 10 * 1024 * 1024 }, err => {
        if (err) resolve({ success: true, mkvPath: sourcePath, url: pathToUrl(sourcePath), native: true })
        else     resolve({ success: true, mkvPath, url: pathToUrl(mkvPath), native: false })
      })
  })
})

// ── Export ────────────────────────────────────────────────────────────────────
ipcMain.handle('save-file', async (_, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'output.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  })
  return canceled ? null : filePath
})

ipcMain.handle('export-video', async (_, { clips, outputPath }) => {
  if (!ffmpegPath) return { success: false, error: 'FFmpeg not found' }
  if (!clips?.length) return { success: false, error: 'No clips' }

  const exportDir = path.join(exportTmpBase, `run-${Date.now()}`)
  fs.mkdirSync(exportDir, { recursive: true })
  const segments = []
  let logPath = outputPath + '.export.log'
  try {
    fs.appendFileSync(logPath, `\n\n=== Export ${new Date().toISOString()} ===\nffmpeg: ${ffmpegPath}\noutput: ${outputPath}\n\n`, 'utf8')
  } catch (_) {
    logPath = path.join(os.tmpdir(), `ve-export-${Date.now()}.log`)
    try { fs.appendFileSync(logPath, `\n\n=== Export ${new Date().toISOString()} ===\nffmpeg: ${ffmpegPath}\noutput: ${outputPath}\n\n`, 'utf8') } catch (_) {}
  }
  const base = probeVideo(clips[0]?.mkvPath, logPath)
  const targetW = base?.width  || 1280
  const targetH = base?.height || 720
  try { fs.appendFileSync(logPath, `[info] target=${targetW}x${targetH}\n`, 'utf8') } catch (_) {}

  try {
    for (let i = 0; i < clips.length; i++) {
      const { mkvPath, sourceStart, sourceDuration, speed } = clips[i]
      const out = path.join(exportDir, `seg_${i}.mp4`)
      segments.push(out)
      send('export-progress', { step: i + 1, total: clips.length + 1, msg: `Encoding clip ${i + 1}/${clips.length}…` })
      const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
                    '-i', mkvPath, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                    '-ss', String(sourceStart), '-t', String(Math.max(0.05, sourceDuration)),
                    '-map', '0:v:0', '-map', '0:a:0?', '-map', '1:a:0']
      if (speed !== 1) {
        args.push('-vf', `setpts=${(1 / speed).toFixed(8)}*PTS`)
        args.push('-af', buildAtempo(speed))
      }
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-y', out)
      try {
        await run(ffmpegPath, args, logPath)
      } catch (err) {
        try { fs.appendFileSync(logPath, `\n[warn] clip ${i + 1}/${clips.length} failed with source audio; retrying with silent audio\n${err.message}\n`, 'utf8') } catch (_) {}
        const args2 = args.slice()
        for (let j = args2.length - 2; j >= 0; j--) {
          if (args2[j] === '-map' && args2[j + 1] === '0:a:0?') { args2.splice(j, 2); break }
        }
        for (let j = args2.length - 2; j >= 0; j--) {
          if (args2[j] === '-af') args2.splice(j, 2)
        }
        await run(ffmpegPath, args2, logPath)
      }
    }
    send('export-progress', { step: clips.length + 1, total: clips.length + 1, msg: 'Concatenating…' })
    const concatArgs = ['-hide_banner', '-loglevel', 'error', '-nostats']
    segments.forEach(s => { concatArgs.push('-i', s) })
    const vNorm = segments.map((_, idx) => `[${idx}:v:0]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${idx}]`).join(';')
    const aNorm = segments.map((_, idx) => `[${idx}:a:0]aformat=sample_rates=44100:channel_layouts=stereo[a${idx}]`).join(';')
    const inputs = segments.map((_, idx) => `[v${idx}][a${idx}]`).join('')
    const filter = `${vNorm};${aNorm};${inputs}concat=n=${segments.length}:v=1:a=1[v][a]`
    concatArgs.push('-filter_complex', filter,
                    '-map', '[v]', '-map', '[a]',
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
                    '-movflags', '+faststart', '-y', outputPath)
    await run(ffmpegPath, concatArgs, logPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  } finally {
    try { fs.rmSync(exportDir, { recursive: true, force: true }) } catch (_) {}
  }
})

// ── Ad placement analysis ─────────────────────────────────────────────────────
ipcMain.handle('analyze-clip', async (_, { videoPath, product, quality, openaiKey, ollamaUrl }) => {
  if (!pythonPath) return { success: false, error: 'Python not found. Make sure the venv at ../venv is set up.' }

  // Fall back to stored settings if caller didn't pass a key
  const settings   = readSettings()
  const resolvedKey = openaiKey || settings.openaiKey || ''
  const resolvedOllama = ollamaUrl || settings.ollamaUrl || ''

  if ((quality === 'openai') && !resolvedKey) {
    return { success: false, error: 'OpenAI API key is required for this quality tier. Set it in Settings (⚙).' }
  }

  const scriptPath  = path.join(__dirname, 'analyze_clip.py')
  const productJson = JSON.stringify(product)

  const args = [scriptPath, '--video', videoPath, '--product-json', productJson, '--quality', quality || 'draft']
  if (resolvedKey)    args.push('--openai-key',  resolvedKey)
  if (resolvedOllama) args.push('--ollama-url',  resolvedOllama)

  return new Promise(resolve => {
    const proc = execFile(
      pythonPath,
      args,
      { maxBuffer: 10 * 1024 * 1024, cwd: path.join(__dirname, '..') },
      (err, stdout, stderr) => {
        if (err && !stdout) { resolve({ success: false, error: stderr || err.message }); return }
        const lines = (stdout || '').trim().split('\n').filter(Boolean)
        const last  = lines[lines.length - 1]
        try { resolve(JSON.parse(last)) }
        catch (_) { resolve({ success: false, error: 'Bad output: ' + last }) }
      }
    )
    proc.stderr?.on('data', d => send('analyze-progress', { msg: d.toString() }))
  })
})

ipcMain.handle('get-python-status', () => ({ available: !!pythonPath, path: pythonPath }))

// ── Ad generation ─────────────────────────────────────────────────────────────
ipcMain.handle('generate-ad', async (_, { clipVideo, sourceStart, sourceDuration, product, quality, openaiKey, ollamaUrl }) => {
  if (!pythonPath) return { success: false, error: 'Python not found.' }

  const settings       = readSettings()
  const resolvedKey    = openaiKey  || settings.openaiKey  || ''
  const resolvedOllama = ollamaUrl  || settings.ollamaUrl  || ''

  if (quality === 'openai' && !resolvedKey)
    return { success: false, error: 'OpenAI API key required. Set it in Settings (⚙).' }

  const projectDir = activeProject?.dir || os.tmpdir()
  const adId       = `ad_${Date.now()}`
  const outputPath = path.join(projectDir, 'working', `${adId}.mp4`)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const scriptPath  = path.join(__dirname, 'generate_ad.py')
  const productJson = JSON.stringify(product)

  // Video generator settings
  const vg         = settings.videoGen || {}
  const vgProvider = vg.provider || ''
  const vgModel    = vg.model    || ''
  const vgKey      = (vg.keys || {})[vg.provider] || ''

  // System prompt
  const systemPrompt = settings.systemPrompt || ''

  const args = [
    scriptPath,
    '--clip-video',      clipVideo,
    '--source-start',    String(sourceStart),
    '--source-duration', String(sourceDuration),
    '--product-json',    productJson,
    '--output-path',     outputPath,
    '--quality',         quality || 'draft',
  ]
  if (resolvedKey)    args.push('--openai-key',  resolvedKey)
  if (resolvedOllama) args.push('--ollama-url',  resolvedOllama)
  if (vgProvider)     args.push('--video-gen-provider', vgProvider)
  if (vgModel)        args.push('--video-gen-model',    vgModel)
  if (vgKey)          args.push('--video-gen-key',      vgKey)
  if (systemPrompt)   args.push('--system-prompt',      systemPrompt)

  return new Promise(resolve => {
    const proc = execFile(pythonPath, args,
      { maxBuffer: 20 * 1024 * 1024, cwd: path.join(__dirname, '..') },
      (err, stdout) => {
        if (err && !stdout) { resolve({ success: false, error: err.message }); return }
        const lines = (stdout || '').trim().split('\n').filter(Boolean)
        const last  = lines[lines.length - 1]
        try { resolve(JSON.parse(last)) }
        catch (_) { resolve({ success: false, error: 'Bad output: ' + last }) }
      }
    )
    proc.stderr?.on('data', d => {
      // Forward both raw text and parsed step objects
      const text = d.toString()
      text.split('\n').filter(Boolean).forEach(line => {
        try {
          const obj = JSON.parse(line)
          send('generate-ad-progress', obj)
        } catch (_) {
          send('generate-ad-progress', { msg: line })
        }
      })
    })
  })
})

// ── Settings (API keys etc.) ──────────────────────────────────────────────────
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) } catch (_) { return {} }
}
ipcMain.handle('get-settings', () => readSettings())
ipcMain.handle('save-settings', (_, settings) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8')
  return true
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function pathToUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '')
}
function sanitizeName(n) {
  return n.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_') || 'project'
}
function send(ch, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
}
function run(bin, args, logPath) {
  return new Promise((res, rej) => {
    let tail = ''
    const write = (s) => {
      tail = (tail + s).slice(-20000)
      if (!logPath) return
      try { fs.appendFileSync(logPath, s, 'utf8') } catch (_) {}
    }
    if (logPath) {
      try { fs.appendFileSync(logPath, `\n$ ${bin} ${args.join(' ')}\n`, 'utf8') } catch (_) {}
    }
    const proc = spawn(bin, args, { windowsHide: true })
    proc.stdout?.on('data', d => write(d.toString()))
    proc.stderr?.on('data', d => write(d.toString()))
    proc.on('error', err => rej(err))
    proc.on('close', code => code === 0 ? res() : rej(new Error(`FFmpeg failed (exit ${code})\n${tail}\nLog: ${logPath || '(none)'}`)))
  })
}
function buildAtempo(speed) {
  const f = []
  let s = speed
  while (s > 2.0) { f.push('atempo=2.0'); s /= 2 }
  while (s < 0.5) { f.push('atempo=0.5'); s /= 0.5 }
  f.push(`atempo=${s.toFixed(6)}`)
  return f.join(',')
}
