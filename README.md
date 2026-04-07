# AdCut — AI Video Editor with Automated Ad Generation & Placement

AdCut is an AI pipeline system that automatically analyzes video scenes, generates context-aware ads, and inserts them into timelines — combining vision models, LLMs, and generative video into a single workflow.

It is a desktop video editor built with Electron that combines professional non-linear editing with a full AI ad-generation pipeline — split, trim, and arrange footage, then use AI to find the perfect ad insertion points, generate ad clips from scene context, and stitch everything together automatically.

---

## Demo

![AdCut Demo](GifEditor.gif)

> 🎬 Edit video like a pro. Generate ads like a studio — all from your desktop, with your own AI keys.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Feature Set](#2-feature-set)
3. [Setup & Running](#3-setup--running)
4. [Editor Layout](#4-editor-layout)
5. [Keyboard Shortcuts](#5-keyboard-shortcuts)
6. [Editing Guide](#6-editing-guide)
7. [AI Ad Generation](#7-ai-ad-generation)
8. [AI Ad Placement Analysis](#8-ai-ad-placement-analysis)
9. [Video Generator Settings](#9-video-generator-settings)
10. [System Prompt Editor](#10-system-prompt-editor)
11. [Settings](#11-settings)
12. [Export](#12-export)
13. [Project Files](#13-project-files)
14. [Architecture](#14-architecture)
15. [Directory Structure](#15-directory-structure)
16. [Tech Stack](#16-tech-stack)
17. [AI Providers & Models](#17-ai-providers--models)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Overview

AdCut is a non-linear video editor built on Electron that pairs a complete clip-based editing workflow with a deeply integrated AI ad-generation system. It is designed for content creators, marketers, and developers who want to take a raw video — a TV show clip, a product review, a social post — and produce polished ad segments that insert seamlessly into the original footage.

The editing side gives you everything you expect from an NLE: multi-track timelines, frame-accurate clip splitting, drag-and-drop rearrangement with magnetic snapping, ripple deletion, per-clip speed control, and a full FFmpeg export pipeline. The AI side connects directly to the [AdsGen](../adsgen) Python pipeline and exposes every part of it through the GUI:

- **Ad Placement Analysis** — runs your clip through a vision model that inspects each scene and scores it for ad suitability against your product's description and tone, then offers to split the clip at the recommended timestamps automatically.
- **Ad Generation** — extracts the last frame of any selected clip, uses a vision model to understand the setting and characters in the scene, writes a contextually appropriate ad script via LLM, generates a short video clip using the AI video service of your choice, synthesizes voice-over audio, merges everything, and drops the finished ad into your timeline in the right position — all in one click.

All AI keys are BYOK (Bring Your Own Key). Nothing is hardcoded. Every provider — OpenAI, Leonardo AI, Runway, Google Veo, HuggingFace, Replicate — is configured through the app's own settings panels and stored locally in `~/.ve-settings.json`. Your keys never leave your machine except to call the respective API.

---

## 2. Feature Set

### Editing

| Feature | Description |
|---|---|
| **Multi-track timeline** | Unlimited video tracks, each with independent clips |
| **Clip splitting** | Split all tracks simultaneously at the playhead with `S` |
| **Ripple delete** | Remove a clip and automatically close the gap by shifting everything after it |
| **Drag & drop** | Reposition clips horizontally or move them between tracks vertically |
| **Magnetic snapping** | Clips snap to other clips' edges, the playhead, and time zero |
| **Per-clip speed** | 0.25× to 4× speed per clip, applied non-destructively during export |
| **Zoom** | Ctrl+Scroll to zoom the timeline anchored to the cursor position, or use toolbar ± buttons |
| **Jump navigation** | `[` / `]` to jump between clip boundaries across all tracks |
| **Preview playback** | Frame-accurate video preview synced to timeline position |
| **Project management** | New / open / save / recent projects via startup screen |
| **Auto-save** | Project state saved automatically 2 seconds after any change |

### AI Ad Generation

| Feature | Description |
|---|---|
| **Last-frame extraction** | Extracts the final frame of the selected clip as the scene reference |
| **Vision scene analysis** | Vision LLM analyses the frame: characters, setting, activity, mood, positions |
| **AI script writing** | LLM writes a short, scene-coherent ad script with dialogue, actions, and transitions |
| **Image-to-video generation** | Sends the frame + prompt to the configured video generator to produce the ad clip |
| **TTS voice-over** | Synthesizes the dialogue using Edge TTS (or ElevenLabs) and merges into the clip |
| **Auto timeline insertion** | Finished ad is added to the Media panel and inserted into the timeline after the source clip, shifting all downstream clips by the ad's duration |
| **Progress streaming** | Step-by-step progress shown in real-time as the Python pipeline runs |

### AI Ad Placement Analysis

| Feature | Description |
|---|---|
| **Scene detection** | Automatically segments the clip into scenes |
| **Per-scene scoring** | Vision model rates each scene for ad suitability against the product's tone and settings |
| **Ranked results** | Returns placement candidates with timestamps, scores, and reasoning |
| **Auto-split** | "Apply Splits" automatically cuts the clip at all recommended insertion points |

### AI Configuration

| Feature | Description |
|---|---|
| **Video Generator panel** | Choose from 8 AI video providers with per-provider API key and free-text model field |
| **System Prompt editor** | Edit the LLM script-writer prompt directly in the app, with one-click reset to default |
| **BYOK across all providers** | Keys for OpenAI, Leonardo, Runway, Veo, HuggingFace, Replicate stored locally per provider |
| **Auto analysis model** | Analysis uses OpenAI GPT-4o if a key is saved, otherwise falls back to local Ollama |

---

## 3. Setup & Running

### Requirements

| Dependency | Notes |
|---|---|
| **Node.js** | v18+ |
| **FFmpeg** | Must be on PATH — `winget install Gyan.FFmpeg` on Windows |
| **Python 3.10+** | Required for AI features only — basic editing works without it |
| **AdsGen venv** | `../venv` with adsgen package installed for analysis and generation |

### 1. Install Node dependencies

```bash
cd Editor
npm install
```

### 2. Set up the Python environment (for AI features)

```bash
cd ..                        # AdsGen root
python -m venv venv
venv\Scripts\activate        # Windows
# or: source venv/bin/activate  (Mac/Linux)
pip install -e .
```

### 3. (Optional) Set up Ollama for local AI

For local analysis and script writing without OpenAI:

```bash
# Install Ollama from https://ollama.ai, then pull the required models:
ollama pull llava:13b    # vision model — for scene analysis
ollama pull llama3:8b    # LLM — for script writing
```

### 4. Run

```bash
npm start
```

The startup screen appears. Create a new project or open a recent one to enter the editor.

### 5. Configure AI providers

1. Click **⚙** in the toolbar → add your OpenAI API key if you want GPT-4o-powered analysis.
2. Click **🎬 Video Gen** → choose your preferred video generator and paste its API key.
3. (Optional) Click **📝 Prompt** to customize the ad script-writing instructions.

---

## 4. Editor Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Toolbar:  Project Name  |  + Import  |  Split  Delete  Ripple Delete    │
│            + Track  |  Speed ▾  Apply  |  −  +  |  Save  Export MP4     │
│            🎬 Video Gen  📝 Prompt  ⚙                                    │
├────────────┬─────────────────────────────────────────────────────────────┤
│  Media     │                                                             │
│  ────────  │                    Preview window                           │
│            │                    (video playback)                         │
│  Products  │                                                             │
│            ├─────────────────────────────────────────────────────────────┤
│            │  ⏮  ▶  ⏭     0:04.2 / 1:23.0     clip-name.mkv            │
├────────────┴─────────────────────────────────────────────────────────────┤
│ Video 1 │  ██████ Ruler ─────────────────────────────────────────────── │
│         │  [  clip A  ────][clip B─][  Ad — Coca-Cola  ][clip C──────]  │
│ Video 2 │          [clip D──────────────]                               │
└─────────┴────────────────────────────────────────────────────────────────┘
```

**Left panel tabs:**

- **Media** — imported files and generated ad clips; click any item to append it to Video 1.
- **Products** — product definitions used by the AI pipeline (name, description, tone, settings, optional script).

**Right-click any clip** to get the full context menu: split, delete, ripple delete, set speed, analyze, or generate an ad.

---

## 5. Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `S` | Split all clips at playhead simultaneously |
| `Del` | Delete selected clip |
| `Shift+Del` | Ripple delete (remove + shift everything after it left) |
| `[` | Jump to previous clip boundary |
| `]` | Jump to next clip boundary |
| `+` / `=` | Zoom timeline in |
| `-` | Zoom timeline out |
| `Ctrl+Scroll` | Zoom timeline anchored to cursor position |
| `Ctrl+S` | Save project |

---

## 6. Editing Guide

### Import

Click **+ Import** to open a file picker (MP4, MOV, AVI, MKV, WebM, M4V, WMV, FLV). Each file is remuxed to an MKV working copy in `project/working/` via FFmpeg stream copy — no re-encoding, no quality loss, just faster seeking. The original source file is never modified.

### Adding Clips to the Timeline

Click any item in the **Media** panel to append it at the end of Video 1. Drag it to reposition after adding.

### Splitting

Move the playhead (click the ruler, or scrub) to the desired cut point, then press `S` or click **Split**. Every track is split simultaneously at that exact time.

### Deleting & Ripple Delete

Select a clip (click it — it highlights). Press `Del` to remove it, leaving a gap. Press `Shift+Del` (or click **Ripple Delete**) to remove it and automatically slide all clips that come after it leftward by the removed clip's duration, eliminating the gap.

### Moving Clips

Drag clips left/right to reposition on their track. Drag up/down to move between tracks. A yellow snap line appears when a clip edge aligns with another clip, the playhead, or time zero — release to snap.

### Speed Control

Select a clip, pick a multiplier (0.25× / 0.5× / 1× / 1.5× / 2× / 4×) from the toolbar dropdown or the right-click menu, and click **Apply** (or select from the context menu directly). A speed badge appears on the clip. Speed is baked in during export using FFmpeg `setpts` and `atempo` filters.

### Multiple Tracks

Click **+ Track** to add another video track. Clips on different tracks are independent. Only **Video 1** is used for preview playback and export — additional tracks are useful for planning or reference.

### Timeline Zoom

Use `+`/`-`, the toolbar buttons, or hold `Ctrl` and scroll over the timeline or ruler. Ctrl+Scroll anchors the zoom to the time position under the mouse cursor, so the view stays centered on your work — identical behaviour to Shotcut.

---

## 7. AI Ad Generation

The most powerful feature of AdCut. With one right-click you can produce a fully AI-generated ad clip tailored to the scene you are currently editing and insert it into the timeline automatically.

### Workflow

1. **Add a product** — switch to the **Products** tab, click **+ Add Product**, and fill in the details. The more descriptive the better: name, description, tone, preferred settings, and an optional suggested dialogue line.
2. **Select a clip** in the timeline (click it).
3. **Right-click → Generate Ad from Last Frame**.
4. Pick the product this ad is for.
5. The info bar shows which analysis model and video generator will be used — adjust via **🎬 Video Gen** and **⚙** if needed.
6. Click **Generate**. The progress overlay streams each step as it runs.

### What Happens Under the Hood

```
Selected clip
      │
      ▼
[1] FFmpeg extracts the last frame of the clip as a JPEG
      │
      ▼
[2] Vision model (GPT-4o or llava:13b) analyses the frame
    → identifies characters, setting, activity, mood, positions
      │
      ▼
[3] LLM writes an ad script
    → character, dialogue, action sequence, transitions
    → respects your product's tone and optional script hint
      │
      ▼
[4] Your chosen video generator animates the frame
    → image-to-video with scene continuity prompt
    → closed-loop post-processing to match first/last frame
      │
      ▼
[5] Edge TTS synthesizes the dialogue as audio
      │
      ▼
[6] FFmpeg merges video + audio into the final ad clip
      │
      ▼
Ad clip saved → added to Media panel
All clips after the source clip shifted right by ad duration
Ad clip inserted at that position on the same track
```

### Product Fields

| Field | Example | Notes |
|---|---|---|
| Name | `Coca-Cola` | Required — appears in the video prompt |
| Description | `A refreshing ice-cold Coke in a red can` | Used in scoring and script generation |
| Tone | `casual, fun, refreshing` | Guides mood matching and script tone |
| Preferred Settings | `kitchen, cafe, restaurant` | Biases scene scoring toward matching environments |
| Script | `Nothing beats an ice-cold Coke!` | Optional suggested dialogue; LLM uses it as a hint |

---

## 8. AI Ad Placement Analysis

Before generating ads, you can ask the AI to find the best places to insert them within a clip.

### Steps

1. Switch to the **Products** tab and add a product.
2. Right-click a clip → **Analyze for Ad Placement**.
3. Pick a product and select the **Analysis model** (Local Ollama or Cloud OpenAI GPT-4o).
4. Click **Analyze**. The progress bar streams analysis output in real time.
5. The **Ad Placement Results** dialog shows a ranked list of timestamps with scores and reasoning for each.
6. Click **Apply Splits** to automatically cut the clip at every recommended insertion point.

The analysis pipeline:

- Detects scene boundaries within the clip
- Extracts keyframes from each scene
- Sends each keyframe to the vision model with the product details
- Scores each scene on setting match, character presence, mood compatibility, and natural pause points
- Returns a ranked list of timestamps where an ad can be seamlessly inserted

---

## 9. Video Generator Settings

Click **🎬 Video Gen** in the toolbar to open the video generator panel.

| Provider | Model Field Default | Key Required | Notes |
| --- | --- | --- | --- |
| **Slideshow** | *(none)* | No | Static image fallback — always works, no AI |
| **Stable Video Diffusion** | `stabilityai/stable-video-diffusion-img2vid-xt` | No | Runs locally on GPU via diffusers (~8 GB download on first run) |
| **CogVideoX** | `THUDM/CogVideoX-5b-I2V` | No | Local GPU inference — ~18 GB VRAM required |
| **HuggingFace Inference** | `akhaliq/veo3.1-fast-image-to-video` | HF Token | Cloud inference, free tier available — any HF image-to-video model ID works |
| **Replicate** | `stability-ai/stable-video-diffusion` | Replicate key | Pay-per-run cloud — replicate.com |
| **Runway Gen-3** | `gen3a_turbo` | Runway key | ~$0.05/s — runwayml.com |
| **Google Veo** | `veo-2.0-generate-001` | Google API key | ~$2–3/clip — requires GCP billing |
| **Leonardo AI / Kling** | `KLING2_5` | Leonardo key | ~$0.10–0.20/clip — app.leonardo.ai |

**The model field is free text** — type any model ID your chosen provider supports. The default is pre-filled when you switch providers.

Per-provider API keys are stored separately in `~/.ve-settings.json`, so switching providers never clears your other keys. Keys are injected as environment variables when the Python script runs and are never stored in project files.

---

## 10. System Prompt Editor

Click **📝 Prompt** in the toolbar to open the script-writer system prompt editor.

The prompt is the full instruction set sent to the LLM when it writes the ad script. It contains a set of required placeholders that are filled in from scene analysis and product data at runtime:

| Placeholder | Filled From |
|---|---|
| `{setting}` | Scene setting detected by vision model |
| `{characters}` | List of visible characters |
| `{character_positions}` | Spatial positions of each character |
| `{activity}` | What the characters are doing |
| `{mood}` | Detected mood/atmosphere |
| `{product_name}` | Product name from the Products panel |
| `{product_description}` | Product description |
| `{product_tone}` | Product tone |
| `{user_script_line}` | Optional suggested dialogue from the product |
| `{min_duration}` / `{max_duration}` | Ad duration range from config |

**Do not remove any placeholders** — the LLM will fail to parse the response if required fields are missing from the prompt. Click **Reset to Default** to restore the built-in prompt at any time. The custom prompt is saved to `~/.ve-settings.json` and applied on the next generation run.

---

## 11. Settings

Click **⚙** in the toolbar to open the Settings panel.

| Setting | Description |
|---|---|
| **OpenAI API Key** | Used for GPT-4o scene analysis and script writing. Stored in `~/.ve-settings.json`. Auto-selected when a key is present. |
| **Ollama Host URL** | Override `http://localhost:11434` if Ollama runs on a non-default host or port. |

All keys are stored locally and never embedded in `.vep` project files. They are passed directly to the Python subprocess at runtime via command-line arguments and environment variables.

---

## 12. Export

Click **Export MP4** in the toolbar and choose a save location. The export pipeline:

1. Collects all clips on **Video 1** sorted by timeline position.
2. For each clip: trims to `sourceStart + sourceDuration`, applies speed filters (`setpts` for video, chained `atempo` for audio), and encodes to H.264 (CRF 18, `fast` preset) + AAC 192k.
3. Concatenates all encoded segments using the FFmpeg concat demuxer with stream copy.

Only Video 1 is exported. Additional tracks are not included in the output.

---

## 13. Project Files

Projects are saved as `.vep` files (plain JSON). Each project lives in its own folder:

```
MyProject/
├── MyProject.vep        ← project state (tracks, clips, products, zoom, playhead)
└── working/
    ├── id3.mkv          ← MKV working copies of imported source files
    ├── id7.mkv
    └── ad_1718291234.mp4  ← generated ad clips
```

Working copies are lossless FFmpeg remuxes (stream copy, no re-encoding). Source files are never modified. Generated ad clips are stored in the same `working/` folder. If you move or delete source files after importing, reopen the project and re-import.

Recent projects (up to 10) are tracked in `~/.ve-recent.json` and shown on the startup screen.

---

## 14. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Electron Main Process (main.js)               │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  Project / File  │  │  FFmpeg pipeline │  │  Settings     │  │
│  │  ipcMain handlers│  │  import / export │  │  ~/.ve-*.json │  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬───────┘  │
│           │                   │                     │           │
│  ┌────────▼────────────────────▼─────────────────────▼───────┐  │
│  │            Python subprocess (execFile)                   │  │
│  │                                                           │  │
│  │  analyze_clip.py          generate_ad.py                  │  │
│  │  └─ adsgen pipeline       └─ adsgen pipeline              │  │
│  │     SceneDetector            SceneAnalyzer (vision)       │  │
│  │     SceneAnalyzer            ScriptWriter (LLM)           │  │
│  │     PlacementSelector        VideoGenerator (I2V API)     │  │
│  │     → JSON stdout            AudioGenerator (TTS)         │  │
│  │     progress → stderr        _merge_audio_into_clip       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ipcMain.handle() / webContents.send()                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ contextBridge (preload.js)
┌───────────────────────────▼─────────────────────────────────────┐
│                   Renderer Process                               │
│  renderer/index.html + editor.js + editor.css                   │
│                                                                 │
│  Project state → render() → DOM timeline + ruler canvas         │
│  Playback: requestAnimationFrame loop + <video> element sync     │
│  Modals: settings, video-gen, system-prompt, analyze, gen-ad    │
└─────────────────────────────────────────────────────────────────┘
```

The Python subprocess communicates over stdio:

- **stdout last line** — final JSON result `{ success, ... }` read after process exit
- **stderr lines** — streamed progress events forwarded to the renderer via `webContents.send()`

---

## 15. Directory Structure

```text
Editor/
├── main.js               ← Electron main: IPC, FFmpeg, Python subprocess management
├── preload.js            ← contextBridge API surface exposed to the renderer
├── launch.js             ← dev launcher (resolves Electron binary path)
├── analyze_clip.py       ← CLI wrapper: runs adsgen placement analysis pipeline
├── generate_ad.py        ← CLI wrapper: runs adsgen ad generation pipeline
├── package.json
├── .gitignore
├── README.md
└── renderer/
    ├── index.html        ← full UI: startup screen, editor, all modals
    ├── editor.js         ← all client-side state, rendering, event handling
    └── editor.css        ← dark theme styles

../adsgen/                ← AI pipeline (Python package)
├── config.py             ← Pydantic config, env var resolution
├── pipeline.py           ← end-to-end pipeline + audio merge helper
├── analyzer/
│   ├── scene_detector.py ← FFmpeg-based scene boundary detection
│   ├── scene_analyzer.py ← vision model frame analysis (Ollama / OpenAI)
│   └── placement.py      ← LLM-based placement scoring and selection
└── generator/
    ├── script_writer.py  ← LLM ad script generation (supports custom prompt)
    ├── video_gen.py      ← image-to-video: Leonardo, Runway, Veo, HF, SVD, ...
    └── audio_gen.py      ← TTS: Edge TTS / ElevenLabs

../config.yaml            ← quality tiers, API key env var references
../venv/                  ← Python virtual environment
```

---

## 16. Tech Stack

| Layer | Technology |
|---|---|
| **Desktop shell** | Electron (main + renderer, contextIsolation) |
| **UI** | Vanilla JS + HTML5 Canvas (ruler) — no framework |
| **Video processing** | FFmpeg (import remux, export encode, frame extraction) |
| **AI pipeline** | Python 3.10+, adsgen package |
| **Vision analysis** | OpenAI GPT-4o / Ollama llava:13b |
| **Script writing** | OpenAI GPT-4o / Ollama llama3:8b |
| **Image-to-video** | Leonardo AI (Kling 2.5), Runway Gen-3, Google Veo 2, HuggingFace, Replicate, SVD, CogVideoX |
| **TTS** | Edge TTS (default) / ElevenLabs |
| **Config** | Pydantic + YAML (`config.yaml`) |
| **Storage** | `.vep` project files (JSON), `~/.ve-settings.json`, `~/.ve-recent.json` |

---

## 17. AI Providers & Models

### Analysis & Script Writing

| Role | Local (Draft) | Cloud (OpenAI) |
|---|---|---|
| Vision / Scene Analysis | `llava:13b` via Ollama | `gpt-4o` |
| Script Writing | `llama3:8b` via Ollama | `gpt-4o` |

Analysis model is auto-selected: OpenAI GPT-4o is used if an API key is saved in Settings, otherwise Ollama is used. You can override this in the **Analyze for Ad Placement** dialog.

### Video Generation

Configure in **🎬 Video Gen**. Model field is free text — use any model ID the provider supports.

| Provider | Default Model | Pricing | Key Env Var |
| --- | --- | --- | --- |
| Slideshow | — | Free | — |
| SVD (local) | `stabilityai/stable-video-diffusion-img2vid-xt` | Free (GPU) | — |
| CogVideoX (local) | `THUDM/CogVideoX-5b-I2V` | Free (GPU) | — |
| HuggingFace | `akhaliq/veo3.1-fast-image-to-video` | Free tier | `HF_TOKEN` |
| Replicate | `stability-ai/stable-video-diffusion` | Pay-per-run | `REPLICATE_API_TOKEN` |
| Runway | `gen3a_turbo` | ~$0.05/s | `RUNWAY_API_KEY` |
| Google Veo | `veo-2.0-generate-001` | ~$2–3/clip | `GOOGLE_API_KEY` |
| Leonardo AI | `KLING2_5` | ~$0.10–0.20/clip | `LEONARDO_API_KEY` |

### TTS

Edge TTS (`en-US-GuyNeural`) is used by default — no API key required. ElevenLabs can be configured in `config.yaml` for higher quality voice synthesis.

---

## 18. Troubleshooting

**App won't start**
Run `node launch.js` directly from the `Editor/` folder to see the raw error. Make sure `npm install` completed successfully.

**FFmpeg not found**
Install FFmpeg and ensure it's on PATH:

```bash
winget install Gyan.FFmpeg          # Windows
brew install ffmpeg                  # macOS
sudo apt install ffmpeg              # Ubuntu
```

Verify with: `ffmpeg -version`

**Analysis / generation fails with "Python not found"**
Set up the venv at `../venv`. The app checks `../venv/Scripts/python.exe` (Windows) and `../venv/bin/python3` (Mac/Linux) before falling back to system Python.

**"No module named adsgen"**
The adsgen package must be installed in the venv:

```bash
cd ..        # AdsGen root
venv\Scripts\activate
pip install -e .
```

**Analysis fails with "NoneType has no attribute strip"**
This was a bug where the vision LLM returned an empty response. It has been fixed in `scene_analyzer.py` and `placement.py` with defensive guards. If you still see it, ensure your Ollama models are fully downloaded: `ollama pull llava:13b`.

**Leonardo / Kling generation times out**
The Leonardo API can take up to 12 minutes per clip. This is normal for long generations. Check your Leonardo API key is valid at app.leonardo.ai and that you have credits available.

**Video generation falls back to slideshow**
This means the configured provider failed. Check:

1. The API key is correct (set in **🎬 Video Gen**)
2. The model name is valid for that provider
3. The console log in the progress overlay for the specific error message

**OpenAI errors**
Verify the API key in **⚙ Settings**. Ensure your account has GPT-4o access and available credits.

**Ollama errors — connection refused**
Ensure Ollama is running before launching AdCut:

```bash
ollama serve
```

And that the required models are pulled:

```bash
ollama pull llava:13b
ollama pull llama3:8b
```

If Ollama runs on a non-default port, update the Ollama Host URL in **⚙ Settings**.

**Generated ad has no audio**
Edge TTS requires internet access. Check your network connection. If TTS fails, the video-only clip is still saved.

**Exported video has wrong speed**
Speed is applied per-clip during export using `setpts` (video) and chained `atempo` filters (audio). Ensure FFmpeg version is recent enough to support `atempo` chaining for speeds above 2× or below 0.5×.
