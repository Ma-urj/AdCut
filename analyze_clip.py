"""
Standalone analysis script called by the Electron editor.
Runs the adsgen pipeline on a video segment and returns placement JSON.
Usage:
  python analyze_clip.py --video <path> --product-json '<json>' [--quality draft]
"""
import sys
import json
import argparse
import tempfile
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--video',        required=True)
    parser.add_argument('--product-json', required=True)
    parser.add_argument('--quality',      default='draft')
    parser.add_argument('--config',       default=None)
    parser.add_argument('--openai-key',   default=None)
    parser.add_argument('--ollama-url',   default=None)
    args = parser.parse_args()

    # adsgen package lives in the parent directory of this script (AdsGen/)
    adsgen_root = str(Path(__file__).resolve().parent.parent)
    if adsgen_root not in sys.path:
        sys.path.insert(0, adsgen_root)

    # Inject API keys into environment BEFORE importing adsgen modules
    if args.openai_key:
        os.environ['OPENAI_API_KEY'] = args.openai_key
    if args.ollama_url:
        os.environ['OLLAMA_HOST'] = args.ollama_url

    product_data = json.loads(args.product_json)

    # Write product to a temp YAML so adsgen can load it
    tmp_yaml = None
    try:
        import yaml

        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.yaml', delete=False, dir=tempfile.gettempdir()
        ) as f:
            yaml.dump({'products': [product_data]}, f)
            tmp_yaml = f.name

        from adsgen.config import load_config
        from adsgen.pipeline import Pipeline

        config_path = Path(args.config) if args.config else None
        app_config  = load_config(config_path=config_path, quality_override=args.quality)
        pipeline    = Pipeline(app_config)

        scenes, analyses, placements = pipeline.analyze(
            video_path=Path(args.video),
            product_path=Path(tmp_yaml),
        )

        result = {
            'success': True,
            'scenes': len(scenes),
            'placements': [
                {
                    'time':        round(p.insertion_time, 3),
                    'score':       round(p.score, 1),
                    'reasoning':   p.reasoning,
                    'scene_index': p.scene.scene_index,
                    'product':     p.product.name,
                }
                for p in placements
            ],
        }
        # Print result as the LAST line so Electron can parse it
        print(json.dumps(result))

    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}))
        sys.exit(1)

    finally:
        if tmp_yaml:
            try:
                os.unlink(tmp_yaml)
            except OSError:
                pass


if __name__ == '__main__':
    main()
