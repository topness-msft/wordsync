# WordSync

Follow along with slowly spoken German news — word-by-word audio highlighting with tap-to-translate.

## What it does

WordSync takes [DW's "Langsam gesprochene Nachrichten"](https://learngerman.dw.com/de/langsam-gesprochene-nachrichten/s-8150) (slowly spoken news for German learners) and turns it into an interactive reading experience:

- 🎧 **Audio playback** — streams directly from DW
- ✨ **Word highlighting** — each word lights up as it's spoken
- 🔤 **Tap to translate** — click any word to see its English translation
- 📱 **Mobile-first** — designed for phones, works everywhere

## How it works

A daily GitHub Actions pipeline:
1. Fetches new episodes from the DW RSS feed
2. Downloads the MP3 and runs [OpenAI Whisper](https://github.com/openai/whisper) for word-level timestamps
3. Aligns Whisper timestamps to the known transcript via fuzzy matching
4. Translates unique words using [DeepL](https://www.deepl.com/)
5. Outputs static JSON and deploys to GitHub Pages

**Cost: $0/month** — Whisper is open source, DeepL free tier, GitHub Pages hosting.

## Local development

```bash
# Install build dependencies
pip install -r build/requirements.txt

# Create .env with your DeepL API key
echo "DEEPL_API_KEY=your-key-here" > .env

# Build episodes (limit to 3 for testing)
python build/build.py --limit 3

# Serve locally
cd site && python -m http.server 8080
```

## Setup

1. Add `DEEPL_API_KEY` as a repository secret
2. Enable GitHub Pages (source: GitHub Actions)
3. The daily cron will auto-fetch and deploy new episodes

## License

Content © Deutsche Welle. This tool is for personal language learning use.
