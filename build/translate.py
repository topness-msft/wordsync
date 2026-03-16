"""Translate German words to English using DeepL."""

import json
import os
import deepl


def load_translation_cache(cache_path):
    """Load existing translations from a JSON file."""
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_translation_cache(cache, cache_path):
    """Save translations to a JSON file."""
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2, sort_keys=True)


def translate_words(words, api_key, cache_path=None):
    """Translate a list of German words to English via DeepL.

    Uses a persistent cache to avoid re-translating known words.
    Returns dict of word → translation.
    """
    if cache_path is None:
        cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "translation_cache.json")
    cache = load_translation_cache(cache_path)

    # Find words not yet in cache
    new_words = [w for w in words if w not in cache]

    if new_words:
        translator = deepl.Translator(api_key)

        # Batch translate in chunks (DeepL has limits per request)
        batch_size = 50
        for i in range(0, len(new_words), batch_size):
            batch = new_words[i:i + batch_size]
            results = translator.translate_text(
                batch,
                source_lang="DE",
                target_lang="EN-US",
            )
            for word, result in zip(batch, results):
                cache[word] = result.text

        save_translation_cache(cache, cache_path)

    return {w: cache.get(w, w) for w in words}
