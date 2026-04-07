"""
Generate an ad clip from a video segment's last frame.
Called by the Electron editor.

Usage:
  python generate_ad.py
    --clip-video     <path>      MKV/mp4 of the source clip
    --source-start   <float>     start time within the source file (seconds)
    --source-duration <float>    duration used from the source file (seconds)
    --product-json   '<json>'    product data as JSON string
    --output-path    <path>      where to write the final ad mp4
    [--quality       draft]
    [--openai-key    sk-...]
    [--ollama-url    http://localhost:11434]
"""
import sys
import json
import argparse
import os
import subprocess
import shutil
import tempfile
from pathlib import Path


def send(obj: dict):
    """Print a JSON object on a single line — Electron reads the last line."""
    print(json.dumps(obj), flush=True)


def send_progress(step: int, total: int, msg: str):
    """Progress updates are printed to stderr so Electron can stream them."""
    print(json.dumps({"step": step, "total": total, "msg": msg}), file=sys.stderr, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--clip-video',        required=True)
    parser.add_argument('--source-start',      type=float, required=True)
    parser.add_argument('--source-duration',   type=float, required=True)
    parser.add_argument('--product-json',      required=True)
    parser.add_argument('--output-path',       required=True)
    parser.add_argument('--quality',           default='draft')
    parser.add_argument('--openai-key',        default=None)
    parser.add_argument('--ollama-url',        default=None)
    # Video generator overrides
    parser.add_argument('--video-gen-provider', default=None,
                        help='Video generator to use: leonardo, runway, veo, huggingface, replicate, cogvideo, svd, slideshow')
    parser.add_argument('--video-gen-model',    default=None,
                        help='Model name/id for the chosen provider')
    parser.add_argument('--video-gen-key',      default=None,
                        help='API key for the chosen video generator')
    # System prompt override
    parser.add_argument('--system-prompt',      default=None,
                        help='Custom script-writer system prompt (uses default if omitted)')
    args = parser.parse_args()

    # Inject API keys BEFORE importing adsgen modules so config resolves them
    if args.openai_key:
        os.environ['OPENAI_API_KEY'] = args.openai_key
    if args.ollama_url:
        os.environ['OLLAMA_HOST'] = args.ollama_url

    # Inject video generator API key into env so config.yaml ${VAR} references resolve
    _VG_ENV_VARS = {
        'leonardo':   'LEONARDO_API_KEY',
        'runway':     'RUNWAY_API_KEY',
        'veo':        'GOOGLE_API_KEY',
        'huggingface':'HF_TOKEN',
        'replicate':  'REPLICATE_API_TOKEN',
    }
    if args.video_gen_key and args.video_gen_provider in _VG_ENV_VARS:
        os.environ[_VG_ENV_VARS[args.video_gen_provider]] = args.video_gen_key

    adsgen_root = str(Path(__file__).resolve().parent.parent)
    if adsgen_root not in sys.path:
        sys.path.insert(0, adsgen_root)

    product_data = json.loads(args.product_json)
    output_path  = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    work_dir = Path(tempfile.mkdtemp(prefix='ve_adgen_'))

    TOTAL_STEPS = 6

    try:
        send_progress(1, TOTAL_STEPS, 'Loading pipeline…')
        from adsgen.config import load_config
        from adsgen.models.schemas import (
            Product, SceneBoundary, PlacementCandidate,
        )
        from adsgen.analyzer.scene_analyzer import SceneAnalyzer
        from adsgen.generator.script_writer import ScriptWriter
        from adsgen.generator.video_gen import VideoGenerator
        from adsgen.generator.audio_gen import AudioGenerator
        from adsgen.pipeline import _merge_audio_into_clip
        from adsgen.ffmpeg_utils import get_ffmpeg

        config  = load_config(quality_override=args.quality)

        # Override video generator if the user chose one explicitly
        if args.video_gen_provider:
            from adsgen.config import ProviderConfig
            new_vg = ProviderConfig(
                type=args.video_gen_provider,
                model=args.video_gen_model or '',
            )
            # Patch the active tier — works with both Pydantic v1 and v2
            tier = config.tiers[config.quality]
            try:
                config.tiers[config.quality] = tier.model_copy(update={'video_gen': new_vg})
            except AttributeError:
                tier.video_gen = new_vg

        ffmpeg  = get_ffmpeg()

        # ── Step 1: Extract last frame of the segment ─────────────────────────
        send_progress(2, TOTAL_STEPS, 'Extracting last frame…')
        last_frame = work_dir / 'last_frame.jpg'
        # Use a point 0.1s before the end so we don't overshoot
        frame_ts = args.source_start + max(0.0, args.source_duration - 0.1)
        r = subprocess.run(
            [ffmpeg, '-y', '-ss', str(frame_ts), '-i', args.clip_video,
             '-vframes', '1', '-q:v', '2', str(last_frame)],
            capture_output=True
        )
        if not last_frame.exists():
            raise RuntimeError('Frame extraction failed: ' + r.stderr.decode()[-400:])

        # ── Step 2: Analyse the last frame with the vision model ──────────────
        send_progress(3, TOTAL_STEPS, 'Analysing scene with vision model…')
        analyzer = SceneAnalyzer(config)
        analysis = analyzer._analyze_frame(last_frame, 0)

        # ── Step 3: Build placement candidate ────────────────────────────────
        product = Product(
            name=product_data['name'],
            images=[],
            description=product_data.get('description', ''),
            tone=product_data.get('tone', ''),
            settings_preference=product_data.get('settings', []),
            script=product_data.get('script') or None,
        )
        scene = SceneBoundary(
            scene_index=0,
            start_time=args.source_start,
            end_time=args.source_start + args.source_duration,
            duration=args.source_duration,
            keyframe_paths=[last_frame],
        )
        placement = PlacementCandidate(
            scene=scene,
            analysis=analysis,
            product=product,
            score=100.0,
            reasoning='User-selected segment — last frame',
            insertion_time=args.source_start + args.source_duration,
            keyframe_path=last_frame,
        )

        # ── Step 4: Write ad script ───────────────────────────────────────────
        send_progress(4, TOTAL_STEPS, 'Writing ad script…')
        scripts = ScriptWriter(config, prompt_template=args.system_prompt or None).generate_scripts([placement])
        if not scripts:
            raise RuntimeError('Script generation produced no output')
        script = scripts[0]
        send_progress(4, TOTAL_STEPS, f'Script: "{script.dialogue}" ({script.duration_seconds}s)')

        # ── Step 5: Generate video ────────────────────────────────────────────
        send_progress(5, TOTAL_STEPS, 'Generating ad video…')
        vid_dir   = work_dir / 'vid'
        vid_gen   = VideoGenerator(config, output_dir=vid_dir)
        keyframes = {0: [last_frame]}          # pass our frame directly
        vid_clips = vid_gen.generate_clips(scripts, keyframes)
        raw_vid   = vid_clips.get(0)
        if not raw_vid or not raw_vid.exists():
            raise RuntimeError('Video generation produced no output')

        # ── Step 6: Generate TTS audio & merge ───────────────────────────────
        send_progress(6, TOTAL_STEPS, 'Generating audio and merging…')
        aud_dir   = work_dir / 'aud'
        aud_gen   = AudioGenerator(config, output_dir=aud_dir)
        aud_clips = aud_gen.generate_audio(scripts)
        aud_path  = aud_clips.get(0)
        _merge_audio_into_clip(raw_vid, aud_path, output_path)

        if not output_path.exists():
            raise RuntimeError('Audio merge step produced no file')

        # Get real duration via ffprobe
        duration = float(script.duration_seconds)
        try:
            probe = subprocess.run(
                [ffmpeg.replace('ffmpeg', 'ffprobe'), '-v', 'quiet',
                 '-show_entries', 'format=duration',
                 '-of', 'default=noprint_wrappers=1:nokey=1', str(output_path)],
                capture_output=True, text=True, timeout=15
            )
            if probe.returncode == 0 and probe.stdout.strip():
                duration = float(probe.stdout.strip())
        except Exception:
            pass

        send({
            'success':   True,
            'adPath':    str(output_path),
            'duration':  duration,
            'dialogue':  script.dialogue,
            'character': script.character_name,
        })

    except Exception as exc:
        send({'success': False, 'error': str(exc)})
        sys.exit(1)

    finally:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


if __name__ == '__main__':
    main()
