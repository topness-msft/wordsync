"""Main build orchestrator for the WordSync pipeline."""

import argparse
import json
import os
import sys

from fetch_episodes import fetch_episode_list, fetch_episode_detail, download_mp3
from align import run_whisper, align_words
from translate import translate_words


def _load_env():
    """Read .env file from project root and set environment variables."""
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())


def _get_existing_episodes(data_dir):
    """Return set of episode IDs that already have JSON files."""
    existing = set()
    if os.path.isdir(data_dir):
        for fname in os.listdir(data_dir):
            if fname.endswith(".json") and fname != "episodes.json":
                try:
                    existing.add(int(fname.replace(".json", "")))
                except ValueError:
                    pass
    return existing


def _format_date(raw_date):
    """Extract YYYY-MM-DD from an ISO date string."""
    if not raw_date:
        return ""
    return raw_date[:10]


def _collect_unique_words(paragraphs):
    """Collect all unique words from aligned paragraphs."""
    words = set()
    for para in paragraphs:
        for w in para.get("words", []):
            words.add(w["word"])
    return sorted(words)


def build_episode(episode_id, api_key, tmp_dir, data_dir, whisper_model="base"):
    """Process a single episode through the full pipeline."""
    print(f"  Fetching episode detail for {episode_id}...")
    detail = fetch_episode_detail(episode_id)

    if not detail["audioUrl"]:
        print(f"  Skipping {episode_id}: no audio URL found")
        return None

    # Download MP3
    mp3_path = os.path.join(tmp_dir, f"{episode_id}.mp3")
    print(f"  Downloading MP3...")
    download_mp3(detail["audioUrl"], mp3_path)

    try:
        # Run Whisper
        print(f"  Running Whisper ({whisper_model} model)...")
        whisper_words = run_whisper(mp3_path, model_name=whisper_model)
        print(f"  Whisper found {len(whisper_words)} words")

        # Align to transcript
        print(f"  Aligning timestamps to transcript...")
        aligned_paragraphs = align_words(whisper_words, detail["paragraphs"])

        # Translate
        print(f"  Translating words...")
        unique_words = _collect_unique_words(aligned_paragraphs)
        translations = translate_words(unique_words, api_key)

        # Add translations to aligned words
        for para in aligned_paragraphs:
            for w in para.get("words", []):
                w["translation"] = translations.get(w["word"], w["word"])

        # Build episode JSON
        episode_json = {
            "id": episode_id,
            "title": detail["title"],
            "date": _format_date(detail["date"]),
            "audioUrl": detail["audioUrl"],
            "duration": detail["duration"],
            "imageUrl": detail["imageUrl"],
            "paragraphs": aligned_paragraphs,
        }

        # Write to site/data/
        output_path = os.path.join(data_dir, f"{episode_id}.json")
        os.makedirs(data_dir, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(episode_json, f, ensure_ascii=False, indent=2)
        print(f"  Written {output_path}")

        return episode_json

    finally:
        # Clean up temp MP3
        if os.path.exists(mp3_path):
            os.remove(mp3_path)
            print(f"  Cleaned up {mp3_path}")


def write_episodes_index(data_dir):
    """Write episodes.json index file sorted by date descending."""
    episodes = []
    for fname in os.listdir(data_dir):
        if fname.endswith(".json") and fname != "episodes.json":
            fpath = os.path.join(data_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            episodes.append({
                "id": data["id"],
                "title": data["title"],
                "date": data["date"],
                "imageUrl": data.get("imageUrl", ""),
                "duration": data.get("duration", 0),
            })

    episodes.sort(key=lambda e: e["date"], reverse=True)

    index_path = os.path.join(data_dir, "episodes.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)
    print(f"Written {index_path} with {len(episodes)} episodes")


def main():
    parser = argparse.ArgumentParser(description="WordSync build pipeline")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only N most recent episodes")
    parser.add_argument("--force", action="store_true",
                        help="Re-process existing episodes")
    parser.add_argument("--model", type=str, default="base",
                        help="Whisper model name (tiny, base, small, medium, large)")
    args = parser.parse_args()

    _load_env()

    api_key = os.environ.get("DEEPL_API_KEY")
    if not api_key:
        print("Error: DEEPL_API_KEY not set. Add it to .env or set as environment variable.")
        sys.exit(1)

    build_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(build_dir)
    data_dir = os.path.join(project_root, "site", "data")
    tmp_dir = os.path.join(build_dir, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)

    # Fetch episode list
    print("Fetching episode list from RSS...")
    episodes = fetch_episode_list()
    print(f"Found {len(episodes)} episodes in feed")

    # Filter to new episodes
    existing = _get_existing_episodes(data_dir)
    if args.force:
        to_process = episodes
    else:
        to_process = [e for e in episodes if e["id"] not in existing]

    if args.limit > 0:
        to_process = to_process[:args.limit]

    print(f"Processing {len(to_process)} episodes (skipping {len(existing)} existing)")

    new_episodes = []
    for episode in to_process:
        print(f"\n--- Processing: {episode['title']} (ID: {episode['id']}) ---")
        try:
            result = build_episode(episode["id"], api_key, tmp_dir, data_dir,
                                   whisper_model=args.model)
            if result:
                new_episodes.append({
                    "id": result["id"],
                    "title": result["title"],
                    "date": result["date"],
                })
        except Exception as e:
            print(f"  Error processing {episode['id']}: {e}")
            continue

    # Write index
    write_episodes_index(data_dir)

    # Write new episodes manifest for downstream jobs (e.g. tweeting)
    manifest_path = os.path.join(project_root, "new_episodes.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(new_episodes, f, ensure_ascii=False, indent=2)
    print(f"New episodes manifest: {len(new_episodes)} episodes written to {manifest_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()
