# Copilot Instructions for WordSync

WordSync is an interactive German language learning site that syncs Deutsche Welle's "Langsam gesprochene Nachrichten" (slowly spoken news) audio with word-level highlighting and tap-to-translate. It's a static site deployed to GitHub Pages at wordsync.app.

## Build & Run

```bash
# Install Python dependencies (requires Python 3.12, ffmpeg)
pip install -r build/requirements.txt

# Set up DeepL API key (required for translations)
echo "DEEPL_API_KEY=your-key" > .env

# Build episodes (use --limit for faster iteration)
python build/build.py --limit 3
python build/build.py --limit 5 --model tiny    # faster, less accurate
python build/build.py --force --limit 1          # rebuild existing episode

# Serve the site locally
cd site && python -m http.server 8080
```

There are no test suites, linters, or type checkers configured.

## Architecture

The project has two independent halves:

**`build/` — Python ETL pipeline** that runs daily via GitHub Actions:
1. `fetch_episodes.py` — Fetches episode list from DW RSS, then calls the DW article API for transcripts and audio URLs
2. `align.py` — Runs OpenAI Whisper with `word_timestamps=True`, then aligns Whisper output to the known transcript using `difflib.SequenceMatcher` with linear interpolation for gaps
3. `translate.py` — Translates unique German words via DeepL API, with a persistent JSON cache (`translation_cache.json`) to avoid redundant API calls
4. `build.py` — Orchestrates the pipeline, outputs per-episode JSON to `site/data/{id}.json` and an index to `site/data/episodes.json`

**`site/` — Vanilla static frontend** (no frameworks, no build step):
- `index.html` — Episode listing, loads `data/episodes.json`
- `player.html` + `js/player.js` — Audio player with word-level highlighting, tap-to-translate, keyboard shortcuts (Space, ←→), and playback speed control (0.5×–1.5×)
- `css/style.css` — Bauhaus-inspired design with CSS custom properties

Data flows one direction: `build/` generates JSON → `site/` reads it at runtime. The frontend never calls external APIs.

## Episode Data Format

Each `site/data/{id}.json` contains:
```json
{
  "id": 75904740,
  "title": "11.02.2026 – Langsam Gesprochene Nachrichten",
  "date": "2026-02-11",
  "audioUrl": "https://radiodownload...",
  "duration": 572,
  "imageUrl": "https://static.dw.com/image/...",
  "paragraphs": [
    {
      "isHeadline": true,
      "text": "Etliche Tote nach Schüssen...",
      "words": [
        { "word": "Etliche", "start": 16.64, "end": 17.46, "translation": "Several" }
      ]
    }
  ]
}
```

## Key Conventions

- **Frontend is vanilla JS** — no frameworks, no bundler, no npm. The entire player is a single IIFE in `player.js`. DOM references are cached as constants at the top. Use `classList` and `dataset` for state.
- **Tap vs hold on words** — Tap/click seeks audio to that word. Hold (400ms+) shows the translation popup; releasing hides the popup and resumes playback. Uses touch events for mobile and mouse events for desktop with a `usedTouch` flag to prevent duplicate handling. Safari long-press context menu is suppressed on words.
- **CSS uses a spacing scale** — custom properties `--s1` (4px) through `--s8` (48px) on an 8px base. Color palette: `--rot` (red), `--blau` (blue), `--gelb` (yellow).
- **Word lookup uses binary search** — `player.js` finds the active word by timestamp with O(log n) search. Maintain this pattern for performance.
- **Translation cache is committed** — `build/translation_cache.json` is checked into git and updated by CI. This is intentional to avoid re-translating known words.
- **Build scripts run from `build/` directory** — imports between build modules are relative (e.g., `from align import run_whisper`). The working directory must be `build/` or the project root.
- **CI auto-commits episode data** — The daily GitHub Actions workflow commits new JSON to `site/data/` and pushes directly to `main`, then deploys to Pages.

## CI/CD

The single workflow (`.github/workflows/daily-build.yml`) runs at 10:30 UTC daily and on manual dispatch. It builds up to 5 new episodes with Whisper base model, commits results, and deploys `site/` to GitHub Pages. Requires the `DEEPL_API_KEY` repository secret.
