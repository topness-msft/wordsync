"""Fetch DW 'Langsam gesprochene Nachrichten' episodes from RSS and API."""

import re
import feedparser
import requests

RSS_URL = "https://rss.dw.com/xml/DKpodcast_lgn_de"
ARTICLE_API = "https://learngerman.dw.com/api/detail/article/{id}?lang=de"


def fetch_episode_list():
    """Fetch list of episodes from the DW RSS feed.

    Returns list of {id, title, date, link}.
    """
    feed = feedparser.parse(RSS_URL)
    episodes = []
    for entry in feed.entries:
        episode_id = entry.get("guid", entry.get("id", ""))
        episodes.append({
            "id": int(episode_id),
            "title": entry.get("title", ""),
            "date": entry.get("published", ""),
            "link": entry.get("link", ""),
        })
    return episodes


def _strip_html(text):
    """Remove HTML tags from text."""
    return re.sub(r"<[^>]+>", "", text).strip()


def _parse_paragraphs(body):
    """Parse the body array into paragraphs with headline detection.

    Each paragraph in body has content.type and content.text.
    Headlines are wrapped in <strong> tags.
    """
    paragraphs = []
    for block in body:
        content = block.get("content", {})
        if content.get("type") != "Paragraph":
            continue
        raw_text = content.get("text", "")
        if not raw_text.strip():
            continue
        is_headline = bool(re.match(r"^\s*<strong>.*</strong>\s*$", raw_text, re.DOTALL))
        clean_text = _strip_html(raw_text)
        if clean_text:
            paragraphs.append({
                "isHeadline": is_headline,
                "text": clean_text,
            })
    return paragraphs


def fetch_episode_detail(episode_id):
    """Fetch full episode data from the DW article API.

    Returns dict with title, date, audioUrl, duration, imageUrl, paragraphs.
    """
    url = ARTICLE_API.format(id=episode_id)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    main = data.get("mainContent", {})

    # Audio URL
    sources = main.get("sources", [])
    audio_url = sources[0]["url"] if sources else ""

    # Duration
    duration = main.get("duration", 0)

    # Image — pick the 700px variant
    image_url = ""
    preview = main.get("previewImage", {})
    sizes = preview.get("sizes", [])
    for s in sizes:
        if s.get("width") == 700:
            image_url = s["url"]
            break
    if not image_url and sizes:
        image_url = sizes[-1].get("url", "")

    # Paragraphs from body
    body = data.get("body", [])
    paragraphs = _parse_paragraphs(body)

    return {
        "id": episode_id,
        "title": data.get("name", ""),
        "date": data.get("displayDate", ""),
        "audioUrl": audio_url,
        "duration": duration,
        "imageUrl": image_url,
        "paragraphs": paragraphs,
    }


def download_mp3(url, output_path):
    """Download an MP3 file to disk."""
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
