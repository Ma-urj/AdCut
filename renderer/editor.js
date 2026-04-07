// ═══════════════════════════════════════════════════════════════════════════
//  VIDEO EDITOR — renderer
// ═══════════════════════════════════════════════════════════════════════════

// ── ID generator ──────────────────────────────────────────────────────────────
let _id = 0
const uid = () => `id${++_id}`

// ── Project state ─────────────────────────────────────────────────────────────
const project = {
  file: null,
  dir:  null,
  name: '',
  isPlaying: false,
  media:    [],  // { id, name, srcPath, mkvPath, url, duration, native }
  tracks:   [{ id: uid(), name: 'Video 1', clips: [] }],
  products: [], // { id, name, description, tone, settings:[], script }
  zoom:     80,
  playhead: 0,
}

// Pending analysis results (for apply step)
let pendingPlacements = []
let analyzeTargetClipId = null

// App-wide settings (API keys etc.)
let appSettings = { openaiKey: '', ollamaUrl: '' }

// ── Save / auto-save ──────────────────────────────────────────────────────────
let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveProject, 2000)
}
async function saveProject() {
  if (!project.file) return
  const data = {
    version: 1, name: project.name,
    media:    project.media.map(m => ({ id: m.id, name: m.name, srcPath: m.srcPath, mkvPath: m.mkvPath, duration: m.duration, native: m.native })),
    tracks:   project.tracks,
    products: project.products,
    zoom:     project.zoom,
    playhead: project.playhead,
  }
  await window.api.saveProject({ projectFile: project.file, data })
}

// ── Clip helpers ──────────────────────────────────────────────────────────────
const clipTlDur   = c => c.sourceDuration / (c.speed || 1)
const clipEnd     = c => c.timelineStart + clipTlDur(c)
const totalDur    = () => Math.max(10, ...project.tracks.flatMap(t => t.clips.map(clipEnd))) + 4

function clipAtTime(time, trackIdx) {
  const t = project.tracks[trackIdx]
  return t ? (t.clips.find(c => time >= c.timelineStart && time < clipEnd(c)) || null) : null
}
function findClip(id) {
  for (const track of project.tracks) {
    const clip = track.clips.find(c => c.id === id)
    if (clip) return { clip, track }
  }
  return null
}
function sortedClips(trackIdx) {
  return (project.tracks[trackIdx]?.clips ?? []).slice().sort((a, b) => a.timelineStart - b.timelineStart)
}

// ── Snapping ──────────────────────────────────────────────────────────────────
// Returns the nearest snap time (within threshold) or null
function snapTime(time, excludeId = null) {
  const thresh = 8 / project.zoom  // 8px in seconds
  let best = null, bestDist = thresh

  const check = t => {
    const d = Math.abs(t - time)
    if (d < bestDist) { bestDist = d; best = t }
  }

  check(0)
  check(project.playhead)
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeId) continue
      check(clip.timelineStart)
      check(clipEnd(clip))
    }
  }
  return best
}

// ── Selected clip ─────────────────────────────────────────────────────────────
let selectedClipId = null

// ── DOM refs ──────────────────────────────────────────────────────────────────
const videoEl        = document.getElementById('video-el')
const noClipMsg      = document.getElementById('no-clip-msg')
const btnPlay        = document.getElementById('btn-play')
const timeDisplay    = document.getElementById('time-display')
const clipInfo       = document.getElementById('clip-info')
const mediaListEl    = document.getElementById('media-list')
const productsListEl = document.getElementById('products-list')
const tlLabels       = document.getElementById('tl-labels')
const tlTracks       = document.getElementById('tl-tracks')
const tlScroll       = document.getElementById('tl-tracks-scroll')
const rulerWrap      = document.getElementById('ruler-wrap')
const rulerCanvas    = document.getElementById('ruler')
const playheadLine   = document.getElementById('playhead-line')

// ── Playback ──────────────────────────────────────────────────────────────────
let rafId          = null
let playOriginTime = null
let playOriginHead = 0
let activeClipId   = null

function startPlay() {
  if (project.isPlaying) return
  project.isPlaying = true
  btnPlay.textContent = '⏸'
  playOriginTime = performance.now()
  playOriginHead = project.playhead
  activeClipId   = null
  rafId = requestAnimationFrame(playLoop)
}
function stopPlay() {
  if (!project.isPlaying) return
  project.isPlaying = false
  btnPlay.textContent = '▶'
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  videoEl.pause()
  activeClipId = null
}
function playLoop() {
  if (!project.isPlaying) return
  project.playhead = playOriginHead + (performance.now() - playOriginTime) / 1000
  if (project.playhead >= totalDur()) { project.playhead = 0; stopPlay(); render(); return }
  syncVideo(); updatePlayheadEl(); updateTimeDisplay()
  rafId = requestAnimationFrame(playLoop)
}
function syncVideo() {
  const clip = clipAtTime(project.playhead, 0)
  if (!clip) { if (!videoEl.paused) videoEl.pause(); activeClipId = null; noClipMsg.style.display = 'block'; return }
  noClipMsg.style.display = 'none'
  const progress = project.playhead - clip.timelineStart
  const srcTime  = clip.sourceStart + progress * (clip.speed || 1)
  if (clip.id !== activeClipId) {
    activeClipId = clip.id
    if (videoEl.src !== clip.url) videoEl.src = clip.url
    videoEl.currentTime  = srcTime
    videoEl.playbackRate = clip.speed || 1
    if (project.isPlaying) videoEl.play().catch(() => {})
  } else {
    if (Math.abs(videoEl.currentTime - srcTime) > 0.25) videoEl.currentTime = srcTime
    videoEl.playbackRate = clip.speed || 1
    if (project.isPlaying && videoEl.paused) videoEl.play().catch(() => {})
  }
}
function seekTo(time) {
  const was = project.isPlaying
  if (was) stopPlay()
  project.playhead = Math.max(0, Math.min(time, totalDur()))
  syncVideo(); updatePlayheadEl(); updateTimeDisplay()
  if (was) { playOriginTime = performance.now(); playOriginHead = project.playhead; activeClipId = null; project.isPlaying = true; btnPlay.textContent = '⏸'; rafId = requestAnimationFrame(playLoop) }
}

// ── Navigation: jump to prev/next clip boundary ────────────────────────────────
function jumpPrev() {
  const all = project.tracks.flatMap(t => t.clips.flatMap(c => [c.timelineStart, clipEnd(c)])).sort((a, b) => a - b)
  const prev = [...all].reverse().find(t => t < project.playhead - 0.05)
  if (prev != null) seekTo(prev)
  else seekTo(0)
}
function jumpNext() {
  const all = project.tracks.flatMap(t => t.clips.flatMap(c => [c.timelineStart, clipEnd(c)])).sort((a, b) => a - b)
  const next = all.find(t => t > project.playhead + 0.05)
  if (next != null) seekTo(next)
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() { renderTracks(); renderRuler(); updatePlayheadEl(); updateTimeDisplay() }

function renderTracks() {
  const totalPx = totalDur() * project.zoom
  tlLabels.innerHTML = ''
  Array.from(tlTracks.querySelectorAll('.track-row')).forEach(el => el.remove())

  project.tracks.forEach((track, ti) => {
    // Label
    const lbl = document.createElement('div')
    lbl.className = 'tl-label'
    lbl.innerHTML = `<span class="tl-label-name">${track.name}</span><button class="btn-del-track" data-tid="${track.id}">×</button>`
    tlLabels.appendChild(lbl)

    // Row
    const row = document.createElement('div')
    row.className = 'track-row'
    row.dataset.ti  = ti
    row.dataset.tid = track.id
    row.style.width = totalPx + 'px'

    track.clips.forEach(clip => {
      const el = document.createElement('div')
      el.className = 'clip' + (clip.id === selectedClipId ? ' selected' : '')
      el.dataset.cid = clip.id
      el.style.left  = (clip.timelineStart * project.zoom) + 'px'
      el.style.width = Math.max(4, clipTlDur(clip) * project.zoom) + 'px'
      el.innerHTML = `<div class="clip-name">${clip.name}</div>${clip.speed !== 1 ? `<div class="clip-speed">${clip.speed}×</div>` : ''}`
      row.appendChild(el)
    })
    tlTracks.insertBefore(row, playheadLine)
  })

  tlTracks.style.width   = totalPx + 'px'
  tlTracks.style.minHeight = (project.tracks.length * 58) + 'px'
}

function renderRuler() {
  const total = totalDur()
  const width = Math.max(total * project.zoom, tlScroll.clientWidth || 800)
  rulerCanvas.width = width; rulerCanvas.height = 26
  const ctx = rulerCanvas.getContext('2d')
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, width, 26)

  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  const interval   = candidates.find(c => c * project.zoom >= 60) || 300
  const minor      = interval / 2

  ctx.font = '9px monospace'; ctx.textBaseline = 'top'
  for (let t = 0; t <= total + interval; t += interval) {
    const x = Math.round(t * project.zoom) + 0.5
    if (x > width) break
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, 26); ctx.stroke()
    ctx.fillStyle = '#666'; ctx.fillText(fmtTime(t), x + 2, 3)
  }
  if (minor * project.zoom > 10) {
    ctx.strokeStyle = '#2e2e2e'
    for (let t = minor; t <= total + minor; t += interval) {
      const x = Math.round(t * project.zoom) + 0.5
      if (x > width) break
      ctx.beginPath(); ctx.moveTo(x, 22); ctx.lineTo(x, 26); ctx.stroke()
    }
  }
}

function updatePlayheadEl() {
  playheadLine.style.left = (project.playhead * project.zoom) + 'px'
}
function updateTimeDisplay() {
  timeDisplay.textContent = `${fmtTime(project.playhead)} / ${fmtTime(totalDur())}`
  const clip = clipAtTime(project.playhead, 0)
  clipInfo.textContent = clip ? `${clip.name}${clip.speed !== 1 ? '  ' + clip.speed + '×' : ''}` : ''
  noClipMsg.style.display = (!clip && !project.isPlaying) ? 'block' : 'none'
}
const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

// ── Edit operations ────────────────────────────────────────────────────────────
function splitAtPlayhead() {
  let changed = false
  project.tracks.forEach(track => {
    const clip = track.clips.find(c => project.playhead > c.timelineStart + 0.02 && project.playhead < clipEnd(c) - 0.02)
    if (!clip) return
    const progress     = project.playhead - clip.timelineStart
    const splitSrc     = clip.sourceStart + progress * (clip.speed || 1)
    const leftDur      = splitSrc - clip.sourceStart
    const rightDur     = clip.sourceDuration - leftDur
    if (leftDur < 0.02 || rightDur < 0.02) return
    const A = { ...clip, id: uid(), sourceDuration: leftDur }
    const B = { ...clip, id: uid(), sourceStart: splitSrc, sourceDuration: rightDur, timelineStart: project.playhead }
    track.clips.splice(track.clips.indexOf(clip), 1, A, B)
    changed = true
  })
  if (changed) { render(); scheduleSave() }
}

function deleteSelected() {
  if (!selectedClipId) return
  const found = findClip(selectedClipId)
  if (!found) return
  found.track.clips = found.track.clips.filter(c => c.id !== selectedClipId)
  selectedClipId = null
  render(); scheduleSave()
}

function rippleDelete() {
  if (!selectedClipId) return
  const found = findClip(selectedClipId)
  if (!found) return
  const { clip, track } = found
  const clipEndTime = clipEnd(clip)
  const gap = clipTlDur(clip)
  // Remove clip
  track.clips = track.clips.filter(c => c.id !== selectedClipId)
  // Shift all clips that start at or after the removed clip's end
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (c.timelineStart >= clipEndTime - 0.001) c.timelineStart -= gap
    }
  }
  selectedClipId = null
  render(); scheduleSave()
}

function applySpeed(speed) {
  if (!selectedClipId) return
  const found = findClip(selectedClipId)
  if (!found) return
  found.clip.speed = speed
  render(); scheduleSave()
}

function addTrack() {
  project.tracks.push({ id: uid(), name: `Video ${project.tracks.length + 1}`, clips: [] })
  render(); scheduleSave()
}
function removeTrack(tid) {
  if (project.tracks.length <= 1) return
  project.tracks = project.tracks.filter(t => t.id !== tid)
  render(); scheduleSave()
}

function addMediaToTimeline(mediaId, trackIdx = 0) {
  const media = project.media.find(m => m.id === mediaId)
  const track = project.tracks[trackIdx]
  if (!media || !track) return
  const end = track.clips.reduce((mx, c) => Math.max(mx, clipEnd(c)), 0)
  const clip = { id: uid(), name: media.name, trackId: track.id, url: media.url, mkvPath: media.mkvPath, sourceStart: 0, sourceDuration: media.duration || 5, timelineStart: end, speed: 1 }
  track.clips.push(clip)
  selectedClipId = clip.id
  render(); scheduleSave()
}

// ── Context menu ──────────────────────────────────────────────────────────────
const ctxMenu = document.getElementById('ctx-menu')
let ctxClipId = null

function showCtx(x, y, clipId) {
  ctxClipId = clipId
  selectedClipId = clipId
  render()
  ctxMenu.style.left = x + 'px'
  ctxMenu.style.top  = y + 'px'
  ctxMenu.classList.remove('hidden')
  const noProducts = project.products.length === 0
  document.getElementById('ctx-analyze').className     = 'ctx-item' + (noProducts ? ' disabled' : '')
  document.getElementById('ctx-generate-ad').className = 'ctx-item' + (noProducts ? ' disabled' : '')
  // Keep menu in viewport
  const r = ctxMenu.getBoundingClientRect()
  if (r.right  > window.innerWidth)  ctxMenu.style.left = (x - r.width)  + 'px'
  if (r.bottom > window.innerHeight) ctxMenu.style.top  = (y - r.height) + 'px'
}
function hideCtx() { ctxMenu.classList.add('hidden'); ctxClipId = null }

ctxMenu.addEventListener('click', e => {
  const item = e.target.closest('.ctx-item')
  if (!item || item.classList.contains('disabled')) return
  const action = item.dataset.action
  hideCtx()
  if      (action === 'split')       splitAtPlayhead()
  else if (action === 'delete')      deleteSelected()
  else if (action === 'ripple')      rippleDelete()
  else if (action === 'analyze')     openAnalyzeModal()
  else if (action === 'generate-ad') openGenerateAdModal()
  else if (action?.startsWith('speed:')) applySpeed(parseFloat(action.split(':')[1]))
})

document.addEventListener('mousedown', e => {
  if (!ctxMenu.contains(e.target)) hideCtx()
})

// ── Clip dragging ─────────────────────────────────────────────────────────────
let drag = null
let snapLine = null

function ensureSnapLine() {
  if (!snapLine) {
    snapLine = document.createElement('div')
    snapLine.id = 'snap-line'
    tlTracks.appendChild(snapLine)
  }
}

function startDrag(e, clipId) {
  e.preventDefault()
  const found = findClip(clipId)
  if (!found) return
  drag = { clipId, startX: e.clientX, startY: e.clientY, origStart: found.clip.timelineStart, origTrackId: found.track.id, moved: false }
}

document.addEventListener('mousemove', e => {
  if (!drag) return
  const dx = e.clientX - drag.startX
  if (!drag.moved && Math.abs(dx) < 3) return
  drag.moved = true

  const found = findClip(drag.clipId)
  if (!found) return
  const { clip, track } = found

  // Raw new position
  let newStart = Math.max(0, drag.origStart + dx / project.zoom)

  // Snap edges
  const snapped = snapTime(newStart, drag.clipId)
  const snappedEnd = snapTime(newStart + clipTlDur(clip), drag.clipId)
  if (snapped !== null) { newStart = snapped; showSnapLine(snapped) }
  else if (snappedEnd !== null) { newStart = snappedEnd - clipTlDur(clip); showSnapLine(snappedEnd) }
  else { hideSnapLine() }

  clip.timelineStart = newStart

  // Track change
  const rows = Array.from(tlTracks.querySelectorAll('.track-row'))
  for (const row of rows) {
    const r = row.getBoundingClientRect()
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      const newTi = parseInt(row.dataset.ti, 10)
      const newTrack = project.tracks[newTi]
      if (newTrack && newTrack.id !== clip.trackId) {
        track.clips = track.clips.filter(c => c.id !== clip.id)
        clip.trackId = newTrack.id
        newTrack.clips.push(clip)
      }
      break
    }
  }
  render()
})

document.addEventListener('mouseup', () => {
  if (drag?.moved) { scheduleSave(); hideSnapLine() }
  drag = null
})

function showSnapLine(time) {
  ensureSnapLine()
  snapLine.style.left    = (time * project.zoom) + 'px'
  snapLine.style.display = 'block'
}
function hideSnapLine() {
  if (snapLine) snapLine.style.display = 'none'
}

// ── Timeline interaction ──────────────────────────────────────────────────────
tlScroll.addEventListener('mousedown', e => {
  const clipEl = e.target.closest('.clip')
  if (clipEl) {
    if (e.button === 0) { selectedClipId = clipEl.dataset.cid; render(); startDrag(e, clipEl.dataset.cid) }
    return
  }
  if (e.button === 0) {
    selectedClipId = null
    const rect = tlScroll.getBoundingClientRect()
    seekTo((e.clientX - rect.left + tlScroll.scrollLeft) / project.zoom)
    render()
  }
})

rulerWrap.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  const rect = rulerWrap.getBoundingClientRect()
  seekTo((e.clientX - rect.left + tlScroll.scrollLeft) / project.zoom)
})

tlScroll.addEventListener('contextmenu', e => {
  e.preventDefault()
  const clipEl = e.target.closest('.clip')
  if (clipEl) showCtx(e.clientX, e.clientY, clipEl.dataset.cid)
})

tlScroll.addEventListener('scroll', () => {
  rulerWrap.scrollLeft = tlScroll.scrollLeft
  tlLabels.scrollTop   = tlScroll.scrollTop
})

// ── Toolbar ───────────────────────────────────────────────────────────────────
document.getElementById('btn-import').addEventListener('click', importFiles)
document.getElementById('btn-split').addEventListener('click', splitAtPlayhead)
document.getElementById('btn-delete').addEventListener('click', deleteSelected)
document.getElementById('btn-ripple').addEventListener('click', rippleDelete)
document.getElementById('btn-add-track').addEventListener('click', addTrack)
document.getElementById('btn-apply-speed').addEventListener('click', () => applySpeed(parseFloat(document.getElementById('speed-select').value)))
document.getElementById('btn-play').addEventListener('click', () => project.isPlaying ? stopPlay() : startPlay())
document.getElementById('btn-prev-clip').addEventListener('click', jumpPrev)
document.getElementById('btn-next-clip').addEventListener('click', jumpNext)
document.getElementById('btn-zoom-in').addEventListener('click',  () => { project.zoom = Math.min(project.zoom * 1.5, 600); render() })
document.getElementById('btn-zoom-out').addEventListener('click', () => { project.zoom = Math.max(project.zoom / 1.5, 4);  render() })
document.getElementById('btn-save').addEventListener('click', saveProject)
document.getElementById('btn-export').addEventListener('click', exportVideo)

// Track labels
tlLabels.addEventListener('click', e => {
  const btn = e.target.closest('.btn-del-track')
  if (btn) removeTrack(btn.dataset.tid)
})

// Media list
mediaListEl.addEventListener('click', e => {
  const item = e.target.closest('.media-item')
  if (item) addMediaToTimeline(item.dataset.mid)
})

// Products tab
document.getElementById('btn-add-product').addEventListener('click', () => {
  document.getElementById('pm-name').value    = ''
  document.getElementById('pm-desc').value    = ''
  document.getElementById('pm-tone').value    = ''
  document.getElementById('pm-settings').value = ''
  document.getElementById('pm-script').value  = ''
  document.getElementById('product-modal').classList.remove('hidden')
})
document.getElementById('pm-cancel').addEventListener('click', () => document.getElementById('product-modal').classList.add('hidden'))
document.getElementById('pm-save').addEventListener('click', () => {
  const name = document.getElementById('pm-name').value.trim()
  if (!name) { alert('Product name is required'); return }
  const prod = {
    id:          uid(),
    name,
    description: document.getElementById('pm-desc').value.trim(),
    tone:        document.getElementById('pm-tone').value.trim(),
    settings:    document.getElementById('pm-settings').value.split(',').map(s => s.trim()).filter(Boolean),
    script:      document.getElementById('pm-script').value.trim(),
  }
  project.products.push(prod)
  document.getElementById('product-modal').classList.add('hidden')
  renderProducts(); scheduleSave()
})

// Left tabs
document.querySelectorAll('.ltab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ltab').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden')
  })
})

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveProject(); return }
  switch (e.key) {
    case ' ':          e.preventDefault(); project.isPlaying ? stopPlay() : startPlay(); break
    case 's': case 'S': splitAtPlayhead(); break
    case 'Delete':
    case 'Backspace':
      e.shiftKey ? rippleDelete() : deleteSelected(); break
    case '[':           jumpPrev(); break
    case ']':           jumpNext(); break
    case '+': case '=': project.zoom = Math.min(project.zoom * 1.5, 600); render(); break
    case '-':           project.zoom = Math.max(project.zoom / 1.5, 4);  render(); break
  }
})

// ── Import ────────────────────────────────────────────────────────────────────
async function importFiles() {
  const paths = await window.api.openFiles()
  if (!paths?.length) return
  const overlay = document.getElementById('import-overlay')
  const prog    = document.getElementById('import-prog')
  const msg     = document.getElementById('import-msg')
  overlay.classList.remove('hidden')

  for (let i = 0; i < paths.length; i++) {
    const srcPath = paths[i]
    if (project.media.find(m => m.srcPath === srcPath)) continue
    const name = srcPath.replace(/\\/g, '/').split('/').pop()
    const mediaId = uid()
    prog.style.width = Math.round((i / paths.length) * 80) + '%'
    msg.textContent  = `Converting ${name} → MKV…`
    const result   = await window.api.importToMkv({ sourcePath: srcPath, mediaId })
    const duration = await getVideoDuration(result.url)
    const item = { id: mediaId, name, srcPath, mkvPath: result.mkvPath, url: result.url, duration, native: result.native }
    project.media.push(item)
    addMediaItemToUI(item)
    mediaListEl.querySelector('.hint')?.remove()
  }
  prog.style.width = '100%'
  setTimeout(() => overlay.classList.add('hidden'), 300)
  scheduleSave()
}

function addMediaItemToUI(media) {
  const el = document.createElement('div')
  el.className = 'media-item'
  el.dataset.mid = media.id
  el.innerHTML = `<div class="mi-name">${media.name}</div><div class="mi-dur">${fmtTime(media.duration || 0)}${media.native ? '' : ' <span class="mi-badge">MKV</span>'}</div>`
  mediaListEl.appendChild(el)
}

function getVideoDuration(url) {
  return new Promise(resolve => {
    const v = document.createElement('video')
    v.preload = 'metadata'; v.src = url
    v.onloadedmetadata = () => resolve(v.duration || 0)
    v.onerror = () => resolve(0)
    setTimeout(() => resolve(0), 8000)
  })
}

// ── Products panel ────────────────────────────────────────────────────────────
function renderProducts() {
  const list = productsListEl
  list.innerHTML = ''
  if (project.products.length === 0) { list.innerHTML = '<div class="hint">No products yet</div>'; return }
  project.products.forEach(prod => {
    const el = document.createElement('div')
    el.className = 'product-item'
    el.dataset.pid = prod.id
    el.innerHTML = `<div class="pi-name">${prod.name}</div><div class="pi-tone">${prod.tone || ''}</div><button class="pi-del" data-pid="${prod.id}">×</button>`
    list.appendChild(el)
  })
}
productsListEl.addEventListener('click', e => {
  const delBtn = e.target.closest('.pi-del')
  if (delBtn) {
    project.products = project.products.filter(p => p.id !== delBtn.dataset.pid)
    renderProducts(); scheduleSave()
  }
})

// ── Ad placement analysis ─────────────────────────────────────────────────────
function openAnalyzeModal() {
  if (project.products.length === 0) { alert('Add a product first in the Products panel.'); return }
  analyzeTargetClipId = selectedClipId  // capture which clip triggered this
  const list = document.getElementById('analyze-product-list')
  list.innerHTML = ''
  project.products.forEach(prod => {
    const el = document.createElement('div')
    el.className = 'analyze-prod-item'
    el.dataset.pid = prod.id
    el.innerHTML = `<div class="ap-name">${prod.name}</div><div class="ap-desc">${(prod.description || '').slice(0, 80)}</div>`
    list.appendChild(el)
  })
  // Select first by default
  list.firstChild?.classList.add('selected')
  document.getElementById('analyze-modal').classList.remove('hidden')
}
document.getElementById('analyze-quality').addEventListener('change', e => {
  const warn = document.getElementById('analyze-key-warn')
  warn.style.display = (e.target.value === 'openai' && !appSettings.openaiKey) ? 'block' : 'none'
})
document.getElementById('analyze-open-settings').addEventListener('click', e => {
  e.preventDefault()
  document.getElementById('analyze-modal').classList.add('hidden')
  document.getElementById('st-openai-key').value = appSettings.openaiKey || ''
  document.getElementById('st-ollama-url').value = appSettings.ollamaUrl || ''
  document.getElementById('settings-modal').classList.remove('hidden')
})

document.getElementById('analyze-product-list').addEventListener('click', e => {
  const item = e.target.closest('.analyze-prod-item')
  if (!item) return
  document.querySelectorAll('.analyze-prod-item').forEach(i => i.classList.remove('selected'))
  item.classList.add('selected')
})
document.getElementById('analyze-cancel').addEventListener('click', () => document.getElementById('analyze-modal').classList.add('hidden'))
document.getElementById('analyze-run').addEventListener('click', async () => {
  const selectedProd = document.querySelector('.analyze-prod-item.selected')
  if (!selectedProd) { alert('Select a product first'); return }
  const prod    = project.products.find(p => p.id === selectedProd.dataset.pid)
  const quality = document.getElementById('analyze-quality').value
  document.getElementById('analyze-modal').classList.add('hidden')

  // Determine video file to analyze
  let videoPath = null
  if (analyzeTargetClipId) {
    const found = findClip(analyzeTargetClipId)
    if (found) videoPath = found.clip.mkvPath
  }
  if (!videoPath) {
    // Use first clip on track 0
    const clips = sortedClips(0)
    if (clips.length === 0) { alert('No clips to analyze'); return }
    videoPath = clips[0].mkvPath
    analyzeTargetClipId = clips[0].id
  }

  // Show progress overlay
  const overlay  = document.getElementById('analyze-overlay')
  const msgEl    = document.getElementById('analyze-msg')
  const progEl   = document.getElementById('analyze-prog')
  overlay.classList.remove('hidden')
  msgEl.textContent  = 'Starting…'
  progEl.style.width = '5%'

  const productPayload = {
    name:                prod.name,
    images:              [],
    description:         prod.description || '',
    tone:                prod.tone || '',
    settings_preference: prod.settings || [],
    script:              prod.script || null,
  }

  const result = await window.api.analyzeClip({
    videoPath, product: productPayload, quality,
    openaiKey: appSettings.openaiKey || '',
    ollamaUrl: appSettings.ollamaUrl || '',
  })
  overlay.classList.add('hidden')
  progEl.style.width = '0%'

  if (!result.success) { alert('Analysis failed:\n' + result.error); return }
  if (!result.placements?.length) { alert('No suitable placement found in this clip.'); return }

  // Show results
  pendingPlacements = result.placements
  showResults()
})

window.api.onAnalyzeProgress(({ msg }) => {
  const el = document.getElementById('analyze-msg')
  el.textContent += msg
  el.scrollTop = el.scrollHeight
  // Fake progress
  const cur = parseFloat(document.getElementById('analyze-prog').style.width || '5')
  if (cur < 90) document.getElementById('analyze-prog').style.width = Math.min(90, cur + 5) + '%'
})

function showResults() {
  const list = document.getElementById('results-list')
  list.innerHTML = ''
  pendingPlacements.forEach((p, i) => {
    const el = document.createElement('div')
    el.className = 'result-item'
    el.dataset.idx = i
    el.innerHTML = `<div class="ri-time">${fmtTime(p.time)}</div><div class="ri-score">Score: ${p.score} — ${p.product}</div><div class="ri-reason">${p.reasoning?.slice(0, 120) || ''}</div>`
    list.appendChild(el)
  })
  document.getElementById('results-modal').classList.remove('hidden')
}
document.getElementById('results-cancel').addEventListener('click', () => {
  document.getElementById('results-modal').classList.add('hidden')
  pendingPlacements = []; analyzeTargetClipId = null
})
document.getElementById('results-apply').addEventListener('click', () => {
  document.getElementById('results-modal').classList.add('hidden')
  if (!analyzeTargetClipId) return

  // Sort placements by time ascending so we split correctly
  const times = [...pendingPlacements].sort((a, b) => a.time - b.time).map(p => p.time)
  const found = findClip(analyzeTargetClipId)
  if (!found) return

  // The times from adsgen are absolute timestamps in the SOURCE file
  // We need to convert to timeline positions
  const { clip, track } = found
  times.forEach(srcTime => {
    if (srcTime <= clip.sourceStart + 0.1 || srcTime >= clip.sourceStart + clip.sourceDuration - 0.1) return
    const progress     = (srcTime - clip.sourceStart) / (clip.speed || 1)
    const tlSplitTime  = clip.timelineStart + progress
    // Split this clip at tlSplitTime
    const c = track.clips.find(c2 => tlSplitTime > c2.timelineStart + 0.02 && tlSplitTime < clipEnd(c2) - 0.02)
    if (!c) return
    const prog2    = tlSplitTime - c.timelineStart
    const splitSrc = c.sourceStart + prog2 * (c.speed || 1)
    const leftDur  = splitSrc - c.sourceStart
    const rightDur = c.sourceDuration - leftDur
    if (leftDur < 0.02 || rightDur < 0.02) return
    const A = { ...c, id: uid(), sourceDuration: leftDur }
    const B = { ...c, id: uid(), sourceStart: splitSrc, sourceDuration: rightDur, timelineStart: tlSplitTime }
    track.clips.splice(track.clips.indexOf(c), 1, A, B)
  })
  pendingPlacements = []; analyzeTargetClipId = null
  render(); scheduleSave()
})

// ── Export ────────────────────────────────────────────────────────────────────
async function exportVideo() {
  const clips = sortedClips(0).map(c => ({ mkvPath: c.mkvPath, sourceStart: c.sourceStart, sourceDuration: c.sourceDuration, speed: c.speed || 1 }))
  if (!clips.length) { alert('No clips on Video 1 to export.'); return }
  const out = await window.api.saveFile('output.mp4')
  if (!out) return
  document.getElementById('export-overlay').classList.remove('hidden')
  document.getElementById('export-prog').style.width = '0%'
  const result = await window.api.exportVideo({ clips, outputPath: out })
  document.getElementById('export-overlay').classList.add('hidden')
  result.success ? alert('Export complete!\n' + out) : alert('Export failed:\n' + result.error)
}
window.api.onExportProgress(({ step, total, msg }) => {
  document.getElementById('export-prog').style.width = Math.round(step / total * 100) + '%'
  document.getElementById('export-msg').textContent  = msg
})

// ── Project loading into editor ───────────────────────────────────────────────
function loadProjectData(data, file, dir) {
  project.file     = file
  project.dir      = dir
  project.name     = data.name || ''
  project.zoom     = data.zoom || 80
  project.playhead = data.playhead || 0
  project.isPlaying = false

  // Rebuild _id counter above loaded IDs
  const allIds = [...(data.media || []), ...(data.products || []),
    ...(data.tracks || []).flatMap(t => [t, ...(t.clips || [])])].map(x => x.id).filter(Boolean)
  allIds.forEach(id => { const n = parseInt(id.replace('id', '')); if (n > _id) _id = n })

  // Media
  project.media = (data.media || []).map(m => ({
    ...m,
    url: pathToFileUrl(m.mkvPath),
  }))

  // Tracks + clips: restore url from mkvPath
  project.tracks = (data.tracks || [{ id: uid(), name: 'Video 1', clips: [] }])
  project.tracks.forEach(track => {
    track.clips = (track.clips || []).map(c => ({ ...c, url: pathToFileUrl(c.mkvPath) }))
  })

  project.products = data.products || []

  document.getElementById('project-name-label').textContent = project.name
  document.title = project.name + ' — Video Editor'

  // Repopulate media list UI
  mediaListEl.innerHTML = ''
  if (project.media.length === 0) mediaListEl.innerHTML = '<div class="hint">Click Import to add videos</div>'
  project.media.forEach(m => addMediaItemToUI(m))

  renderProducts()
  render()
}

function pathToFileUrl(p) {
  if (!p) return ''
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '')
}

// ══════════════════════════════════════════════════════════════════════════════
//  STARTUP / PROJECT PICKER
// ══════════════════════════════════════════════════════════════════════════════
const startupScreen = document.getElementById('startup-screen')
const editorScreen  = document.getElementById('editor-screen')

function showEditor() {
  startupScreen.classList.add('hidden')
  editorScreen.classList.remove('hidden')
  render()
}

// Populate recent projects
async function initStartup() {
  const recents = await window.api.getRecentProjects()
  const list    = document.getElementById('recent-list')
  list.innerHTML = ''
  if (!recents.length) { list.innerHTML = '<div class="hint">No recent projects</div>'; return }
  recents.forEach(filePath => {
    const name = filePath.replace(/\\/g, '/').split('/').pop().replace('.vep', '')
    const dir  = filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const el   = document.createElement('div')
    el.className = 'recent-item'
    el.innerHTML = `<div><div class="ri-name">${name}</div><div class="ri-path">${dir}</div></div>`
    el.addEventListener('click', async () => {
      try {
        const { data, projectFile } = await window.api.openProject(filePath)
        const proj = await window.api.getActiveProject()
        loadProjectData(data, projectFile, proj?.dir || '')
        showEditor()
      } catch (_) { alert('Could not open project: ' + filePath) }
    })
    list.appendChild(el)
  })
}

// New project
let newProjectFolder = null
document.getElementById('btn-new-project').addEventListener('click', () => {
  newProjectFolder = null
  document.getElementById('np-name').value   = 'My Project'
  document.getElementById('np-folder').value = ''
  document.getElementById('new-project-modal').classList.remove('hidden')
})
document.getElementById('np-browse').addEventListener('click', async () => {
  const folder = await window.api.pickProjectFolder()
  if (folder) {
    newProjectFolder = folder
    document.getElementById('np-folder').value = folder
  }
})
document.getElementById('np-cancel').addEventListener('click', () => document.getElementById('new-project-modal').classList.add('hidden'))
document.getElementById('np-create').addEventListener('click', async () => {
  const name = document.getElementById('np-name').value.trim()
  if (!name) { alert('Enter a project name'); return }
  if (!newProjectFolder) { alert('Choose a folder'); return }
  document.getElementById('new-project-modal').classList.add('hidden')
  const { data, projectFile } = await window.api.createProject({ folderPath: newProjectFolder, name })
  const proj = await window.api.getActiveProject()
  loadProjectData(data, projectFile, proj?.dir || newProjectFolder)
  showEditor()
})

// Open project
document.getElementById('btn-open-project').addEventListener('click', async () => {
  const filePath = await window.api.pickProjectFile()
  if (!filePath) return
  const { data, projectFile } = await window.api.openProject(filePath)
  const proj = await window.api.getActiveProject()
  loadProjectData(data, projectFile, proj?.dir || '')
  showEditor()
})

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => renderRuler())

// ── Ad Generation ─────────────────────────────────────────────────────────────
let genAdTargetClipId = null

function openGenerateAdModal() {
  if (project.products.length === 0) { alert('Add a product first in the Products panel.'); return }
  genAdTargetClipId = selectedClipId

  const list = document.getElementById('gen-ad-product-list')
  list.innerHTML = ''
  project.products.forEach(prod => {
    const el = document.createElement('div')
    el.className = 'analyze-prod-item'
    el.dataset.pid = prod.id
    el.innerHTML = `<div class="ap-name">${prod.name}</div><div class="ap-desc">${(prod.description || '').slice(0, 80)}</div>`
    list.appendChild(el)
  })
  list.firstChild?.classList.add('selected')

  // Show analysis model + video generator info (read-only, configured in settings)
  const hasOpenAI = !!(appSettings.openaiKey || '').trim()
  const analysisModel = hasOpenAI ? 'OpenAI GPT-4o' : 'Local Ollama (llava + llama3)'
  const vg = appSettings.videoGen || {}
  const vgProvider = vg.provider || 'slideshow'
  const vgModel    = vg.model    || VG_PROVIDERS[vgProvider]?.defaultModel || ''
  const vgLabel    = VG_PROVIDERS[vgProvider]?.label || vgProvider
  document.getElementById('gen-ad-analysis-info').innerHTML =
    `<span style="color:#888">Analysis:</span> ${analysisModel} &nbsp;|&nbsp; ` +
    `<span style="color:#888">Video:</span> ${vgLabel}${vgModel ? ' <span style="color:#555">(' + vgModel + ')</span>' : ''}`

  document.getElementById('gen-ad-modal').classList.remove('hidden')
}

document.getElementById('gen-ad-product-list').addEventListener('click', e => {
  const item = e.target.closest('.analyze-prod-item')
  if (!item) return
  document.querySelectorAll('#gen-ad-product-list .analyze-prod-item').forEach(i => i.classList.remove('selected'))
  item.classList.add('selected')
})

document.getElementById('gen-ad-cancel').addEventListener('click', () =>
  document.getElementById('gen-ad-modal').classList.add('hidden'))

document.getElementById('gen-ad-run').addEventListener('click', async () => {
  const selProd = document.querySelector('#gen-ad-product-list .analyze-prod-item.selected')
  if (!selProd) { alert('Select a product first'); return }
  const prod    = project.products.find(p => p.id === selProd.dataset.pid)
  // Auto-select analysis quality: use OpenAI if a key is present, else local Ollama
  const quality = (appSettings.openaiKey || '').trim() ? 'openai' : 'draft'
  document.getElementById('gen-ad-modal').classList.add('hidden')

  // Resolve the clip
  const found = genAdTargetClipId ? findClip(genAdTargetClipId) : null
  if (!found) { alert('No clip selected for ad generation.'); return }
  const { clip } = found

  // Show progress overlay
  const overlay = document.getElementById('gen-ad-overlay')
  const progEl  = document.getElementById('gen-ad-prog')
  const stepEl  = document.getElementById('gen-ad-step')
  const logEl   = document.getElementById('gen-ad-log')
  overlay.classList.remove('hidden')
  progEl.style.width = '2%'
  stepEl.textContent = 'Starting…'
  logEl.textContent  = ''

  const productPayload = {
    name:                prod.name,
    images:              [],
    description:         prod.description  || '',
    tone:                prod.tone         || '',
    settings:            prod.settings     || [],
    script:              prod.script       || null,
  }

  const result = await window.api.generateAd({
    clipVideo:      clip.mkvPath,
    sourceStart:    clip.sourceStart,
    sourceDuration: clip.sourceDuration,
    product:        productPayload,
    quality,
    openaiKey:  appSettings.openaiKey || '',
    ollamaUrl:  appSettings.ollamaUrl || '',
  })

  overlay.classList.add('hidden')
  progEl.style.width = '0%'

  if (!result.success) {
    alert('Ad generation failed:\n' + result.error)
    genAdTargetClipId = null
    return
  }

  // Build a file:// URL from the returned path
  const adUrl = pathToFileUrl(result.adPath)
  const adDuration = result.duration || 5

  // Add to media
  const adMediaId = uid()
  const adName    = `Ad — ${prod.name} (${fmtTime(adDuration)})`
  const adMedia   = { id: adMediaId, name: adName, srcPath: result.adPath, mkvPath: result.adPath, url: adUrl, duration: adDuration, native: true }
  project.media.push(adMedia)
  mediaListEl.querySelector('.hint')?.remove()
  addMediaItemToUI(adMedia)

  // Insert into timeline after the target clip, shifting subsequent clips
  insertGeneratedAd(genAdTargetClipId, adMedia, found.track)
  genAdTargetClipId = null
  scheduleSave()
})

function insertGeneratedAd(afterClipId, adMedia, preferredTrack) {
  const found = findClip(afterClipId)
  if (!found) return
  const { clip, track } = found
  const insertAt  = clipEnd(clip)
  const adDur     = adMedia.duration

  // Shift every clip on every track that starts at or after insertAt
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (c.timelineStart >= insertAt - 0.001) c.timelineStart += adDur
    }
  }

  // Place the ad clip immediately after segment A on the same track
  const adClip = {
    id:             uid(),
    name:           adMedia.name,
    trackId:        track.id,
    url:            adMedia.url,
    mkvPath:        adMedia.mkvPath,
    sourceStart:    0,
    sourceDuration: adDur,
    timelineStart:  insertAt,
    speed:          1,
  }
  track.clips.push(adClip)
  selectedClipId = adClip.id
  render()
}

// Stream progress from main process
window.api.onGenerateProgress(({ step, total, msg }) => {
  if (step && total) {
    document.getElementById('gen-ad-prog').style.width = Math.round(step / total * 100) + '%'
    document.getElementById('gen-ad-step').textContent = msg || ''
  } else if (msg) {
    const log = document.getElementById('gen-ad-log')
    log.textContent += msg + '\n'
    log.scrollTop = log.scrollHeight
  }
})

// ── Ctrl+Scroll to zoom timeline ──────────────────────────────────────────────
function zoomAtMouse(e, containerEl) {
  e.preventDefault()
  const rect         = containerEl.getBoundingClientRect()
  const mouseTimeSec = (e.clientX - rect.left + tlScroll.scrollLeft) / project.zoom
  const factor       = e.deltaY < 0 ? 1.2 : 1 / 1.2
  project.zoom       = Math.max(4, Math.min(600, project.zoom * factor))
  render()
  // Keep the time position under the cursor fixed after zoom
  const newLeft = mouseTimeSec * project.zoom - (e.clientX - rect.left)
  requestAnimationFrame(() => { tlScroll.scrollLeft = Math.max(0, newLeft) })
}

tlScroll.addEventListener('wheel', e => { if (e.ctrlKey) zoomAtMouse(e, tlScroll)  }, { passive: false })
rulerWrap.addEventListener('wheel', e => { if (e.ctrlKey) zoomAtMouse(e, rulerWrap) }, { passive: false })

// ── Settings modal ────────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('st-openai-key').value = appSettings.openaiKey || ''
  document.getElementById('st-ollama-url').value = appSettings.ollamaUrl || ''
  document.getElementById('settings-modal').classList.remove('hidden')
})
document.getElementById('st-cancel').addEventListener('click', () =>
  document.getElementById('settings-modal').classList.add('hidden'))

document.getElementById('st-toggle-key').addEventListener('click', () => {
  const inp = document.getElementById('st-openai-key')
  const btn = document.getElementById('st-toggle-key')
  if (inp.type === 'password') { inp.type = 'text';     btn.textContent = 'Hide' }
  else                         { inp.type = 'password'; btn.textContent = 'Show' }
})

document.getElementById('st-save').addEventListener('click', async () => {
  appSettings.openaiKey = document.getElementById('st-openai-key').value.trim()
  appSettings.ollamaUrl = document.getElementById('st-ollama-url').value.trim()
  await window.api.saveSettings(appSettings)
  document.getElementById('settings-modal').classList.add('hidden')
})

// ── Video Generator Modal ─────────────────────────────────────────────────────
const VG_PROVIDERS = {
  slideshow:   { label: 'Slideshow (static fallback)',  defaultModel: '',                             needsKey: false, envVar: '',                    notes: 'No API key required. Uses FFmpeg to create a static image video from the last frame. Always works.' },
  svd:         { label: 'Stable Video Diffusion',       defaultModel: 'stabilityai/stable-video-diffusion-img2vid-xt', needsKey: false, envVar: '', notes: 'Runs locally on GPU via diffusers. First run downloads weights (~8 GB). Requires CUDA.' },
  cogvideo:    { label: 'CogVideoX',                    defaultModel: 'THUDM/CogVideoX-5b-I2V',       needsKey: false, envVar: '',                    notes: 'Runs locally on GPU. ~18 GB VRAM required. First run downloads model weights.' },
  huggingface: { label: 'HuggingFace Inference',        defaultModel: 'akhaliq/veo3.1-fast-image-to-video', needsKey: true, envVar: 'HF_TOKEN',    notes: 'Cloud inference via HuggingFace token (free tier available). Model field accepts any HF image-to-video model ID.' },
  replicate:   { label: 'Replicate',                    defaultModel: 'stability-ai/stable-video-diffusion', needsKey: true, envVar: 'REPLICATE_API_TOKEN', notes: 'Pay-per-run cloud inference. Get your token at replicate.com.' },
  runway:      { label: 'Runway Gen-3',                 defaultModel: 'gen3a_turbo',                  needsKey: true,  envVar: 'RUNWAY_API_KEY',      notes: 'Runway image-to-video API. ~$0.05/s. Get your key at runwayml.com.' },
  veo:         { label: 'Google Veo',                   defaultModel: 'veo-2.0-generate-001',         needsKey: true,  envVar: 'GOOGLE_API_KEY',      notes: 'Google Cloud Veo 2. Requires billing enabled on GCP. ~$2–3/clip. Get key at console.cloud.google.com.' },
  leonardo:    { label: 'Leonardo AI / Kling',          defaultModel: 'KLING2_5',                     needsKey: true,  envVar: 'LEONARDO_API_KEY',    notes: 'Leonardo AI image-to-video using Kling 2.5 (10 s clips). ~$0.10–0.20/clip. Get key at app.leonardo.ai → API.' },
}

function openVideoGenModal() {
  const vg = appSettings.videoGen || {}
  const provider = vg.provider || 'leonardo'

  // Populate provider selector
  const sel = document.getElementById('vg-provider')
  sel.value = provider

  // Restore per-provider model + key
  updateVgProviderUI(provider, vg)

  document.getElementById('video-gen-modal').classList.remove('hidden')
}

function updateVgProviderUI(provider, vg = appSettings.videoGen || {}) {
  const info = VG_PROVIDERS[provider] || VG_PROVIDERS.slideshow
  const models = vg.models || {}
  const keys   = vg.keys   || {}

  // Model field
  const modelEl = document.getElementById('vg-model')
  modelEl.value = models[provider] !== undefined ? models[provider] : info.defaultModel
  document.getElementById('vg-model-hint').textContent =
    info.defaultModel ? `Default: ${info.defaultModel}` : 'No specific model required'

  // Key row visibility
  const keyRow = document.getElementById('vg-key-row')
  keyRow.style.display = info.needsKey ? 'block' : 'none'
  if (info.needsKey) {
    document.getElementById('vg-key').value = keys[provider] || ''
    document.getElementById('vg-key-label').textContent = `Stored locally. Passed as ${info.envVar} to the Python script.`
  }

  // Notes
  document.getElementById('vg-notes').textContent = info.notes
}

document.getElementById('vg-provider').addEventListener('change', e => {
  updateVgProviderUI(e.target.value)
})

document.getElementById('vg-toggle-key').addEventListener('click', () => {
  const inp = document.getElementById('vg-key')
  const btn = document.getElementById('vg-toggle-key')
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide' }
  else                         { inp.type = 'password'; btn.textContent = 'Show' }
})

document.getElementById('vg-cancel').addEventListener('click', () =>
  document.getElementById('video-gen-modal').classList.add('hidden'))

document.getElementById('vg-save').addEventListener('click', async () => {
  const provider = document.getElementById('vg-provider').value
  const model    = document.getElementById('vg-model').value.trim()
  const key      = document.getElementById('vg-key').value.trim()

  if (!appSettings.videoGen) appSettings.videoGen = { keys: {}, models: {} }
  if (!appSettings.videoGen.keys)   appSettings.videoGen.keys   = {}
  if (!appSettings.videoGen.models) appSettings.videoGen.models = {}

  appSettings.videoGen.provider         = provider
  appSettings.videoGen.model            = model   // convenience: active model
  appSettings.videoGen.models[provider] = model
  if (key) appSettings.videoGen.keys[provider] = key

  await window.api.saveSettings(appSettings)
  document.getElementById('video-gen-modal').classList.add('hidden')
})

document.getElementById('btn-video-gen').addEventListener('click', openVideoGenModal)

// ── System Prompt Modal ────────────────────────────────────────────────────────
// Default prompt — kept in sync with adsgen/generator/script_writer.py
const DEFAULT_SYSTEM_PROMPT = `You are writing a short in-scene ad moment for an existing TV scene.

SCENE CONTEXT:
- Setting: {setting}
- Visible characters: {characters}
- Character positions: {character_positions}
- Current activity: {activity}
- Mood: {mood}

PRODUCT:
- Name: {product_name}
- Description: {product_description}
- Tone: {product_tone}
{user_script_line}

GOAL:
Create a seamless pause-and-resume ad beat.
1. The clip starts from the same framing and continuity as the paused scene.
2. Choose exactly one visible character from the list above.
3. That character moves naturally to get/use the product.
4. The character says one short line.
5. The character returns to their original position and pose.
6. The clip ends with visual continuity so the original show can resume cleanly.

RULES:
- Keep actions physically plausible for the setting.
- Keep the line natural and short.
- Keep duration between {min_duration}-{max_duration} seconds.
- Product must be physically retrieved from a plausible location.
- Never transform an existing object into the product.
- Product should be put back before the character returns to their exact original mark.

Return ONLY valid JSON:
{{
  "character_name": "one chosen visible character",
  "action_sequence": [
    "step-by-step actions"
  ],
  "dialogue": "short spoken line",
  "duration_seconds": 8,
  "transition_in": "how the ad beat starts from the paused scene",
  "transition_out": "how the character returns and scene resumes",
  "scene_description": "precise cinematic description of this same scene with continuity"
}}`

function openSystemPromptModal() {
  const ta = document.getElementById('sp-textarea')
  ta.value = appSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT
  document.getElementById('system-prompt-modal').classList.remove('hidden')
}

document.getElementById('btn-system-prompt').addEventListener('click', openSystemPromptModal)

document.getElementById('sp-reset').addEventListener('click', () => {
  document.getElementById('sp-textarea').value = DEFAULT_SYSTEM_PROMPT
})

document.getElementById('sp-cancel').addEventListener('click', () =>
  document.getElementById('system-prompt-modal').classList.add('hidden'))

document.getElementById('sp-save').addEventListener('click', async () => {
  const val = document.getElementById('sp-textarea').value
  // Store null (= use default) if it matches the default exactly
  appSettings.systemPrompt = (val.trim() === DEFAULT_SYSTEM_PROMPT.trim()) ? '' : val
  await window.api.saveSettings(appSettings)
  document.getElementById('system-prompt-modal').classList.add('hidden')
})

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  appSettings = (await window.api.getSettings()) || {}
  initStartup()
}
init()
