"""Run Whisper for word-level timestamps and align to known transcript."""

import copy
import re
import difflib
import whisper


def run_whisper(mp3_path, model_name="base"):
    """Run Whisper on an MP3 file with word-level timestamps.

    Returns list of {word, start, end} flattened from all segments.
    """
    model = whisper.load_model(model_name)
    result = model.transcribe(
        mp3_path,
        word_timestamps=True,
        language="de",
    )

    words = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            words.append({
                "word": w["word"].strip(),
                "start": round(w["start"], 2),
                "end": round(w["end"], 2),
            })
    return words


def _normalize(word):
    """Normalize a word for comparison: lowercase, strip punctuation."""
    return re.sub(r"[^\w]", "", word.lower())


def align_words(whisper_words, transcript_paragraphs):
    """Align Whisper timestamps to the known transcript.

    The transcript text is ground truth — we only use Whisper for timing.

    1. Flatten transcript paragraphs into ordered word list with indices
    2. Flatten Whisper words
    3. Normalize both for comparison
    4. Use SequenceMatcher to find matching blocks
    5. Transfer timestamps from matched Whisper words to transcript words
    6. Interpolate timestamps for unmatched gaps
    7. Return paragraphs with words enriched with start/end times
    """
    # Flatten transcript into word list with (paragraph_idx, word_idx, word_text)
    transcript_flat = []
    for p_idx, para in enumerate(transcript_paragraphs):
        words = para["text"].split()
        for w_idx, word in enumerate(words):
            transcript_flat.append((p_idx, w_idx, word))

    if not transcript_flat:
        return transcript_paragraphs

    # Normalize sequences for matching
    norm_transcript = [_normalize(w[2]) for w in transcript_flat]
    norm_whisper = [_normalize(w["word"]) for w in whisper_words]

    # Find matching blocks via SequenceMatcher
    matcher = difflib.SequenceMatcher(None, norm_transcript, norm_whisper, autojunk=False)
    matching_blocks = matcher.get_matching_blocks()

    # Build timestamp array for transcript words (None = unmatched)
    timestamps = [None] * len(transcript_flat)

    for block in matching_blocks:
        t_start, w_start, size = block
        for i in range(size):
            t_idx = t_start + i
            w_idx = w_start + i
            if w_idx < len(whisper_words):
                timestamps[t_idx] = (whisper_words[w_idx]["start"], whisper_words[w_idx]["end"])

    # Interpolate gaps from surrounding matched words
    _interpolate_gaps(timestamps)

    # Build result paragraphs
    result = copy.deepcopy(transcript_paragraphs)
    for para in result:
        para["words"] = []

    for i, (p_idx, w_idx, word_text) in enumerate(transcript_flat):
        ts = timestamps[i]
        if ts:
            start, end = ts
        else:
            start, end = 0.0, 0.0
        result[p_idx]["words"].append({
            "word": word_text,
            "start": round(start, 2),
            "end": round(end, 2),
        })

    return result


def _interpolate_gaps(timestamps):
    """Fill None gaps in timestamps by linear interpolation from neighbors."""
    n = len(timestamps)

    # Find runs of None values and interpolate between anchors
    i = 0
    while i < n:
        if timestamps[i] is not None:
            i += 1
            continue

        # Find start of gap
        gap_start = i

        # Find end of gap
        while i < n and timestamps[i] is None:
            i += 1
        gap_end = i  # exclusive

        # Find left anchor
        if gap_start > 0 and timestamps[gap_start - 1] is not None:
            left_time = timestamps[gap_start - 1][1]  # end time of previous word
        else:
            left_time = 0.0

        # Find right anchor
        if gap_end < n and timestamps[gap_end] is not None:
            right_time = timestamps[gap_end][0]  # start time of next word
        else:
            right_time = left_time

        # Linearly distribute timestamps across the gap
        gap_len = gap_end - gap_start
        if gap_len > 0:
            duration = right_time - left_time
            word_duration = duration / gap_len if gap_len > 0 else 0
            for j in range(gap_len):
                start = left_time + j * word_duration
                end = left_time + (j + 1) * word_duration
                timestamps[gap_start + j] = (start, end)
