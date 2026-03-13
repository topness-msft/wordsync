(function () {
  'use strict';

  // --- DOM refs ---
  const audio = document.getElementById('audio');
  const transcript = document.getElementById('transcript');
  const playBtn = document.getElementById('play-btn');
  const iconPlay = playBtn.querySelector('.icon-play');
  const iconPause = playBtn.querySelector('.icon-pause');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const currentTimeEl = document.getElementById('current-time');
  const totalTimeEl = document.getElementById('total-time');
  const popup = document.getElementById('translation-popup');
  const popupOverlay = document.getElementById('popup-overlay');
  const popupWord = popup.querySelector('.popup-word');
  const popupTranslation = popup.querySelector('.popup-translation');
  const popupClose = popup.querySelector('.popup__close');

  // --- State ---
  let wordEntries = []; // { el, start, end }  sorted by start
  let activeWord = null;

  // --- Helpers ---
  function formatTime(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function getEpisodeId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  // --- Episode loading ---
  async function loadEpisode() {
    const id = getEpisodeId();
    if (!id) {
      transcript.innerHTML = '<p class="error">No episode specified.</p>';
      return;
    }

    try {
      const res = await fetch('data/' + encodeURIComponent(id) + '.json');
      if (!res.ok) throw new Error('Episode not found');
      const data = await res.json();

      document.getElementById('episode-title').textContent = data.title;
      document.getElementById('episode-date').textContent = formatDate(data.date);
      document.title = 'WordSync – ' + data.title;

      audio.src = data.audioUrl;

      renderTranscript(data.paragraphs);
      buildWordIndex();
    } catch (err) {
      transcript.innerHTML = '<p class="error">Could not load episode.</p>';
      console.error(err);
    }
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // --- Transcript rendering ---
  function renderTranscript(paragraphs) {
    transcript.innerHTML = '';
    for (const para of paragraphs) {
      const div = document.createElement('div');
      div.className = 'paragraph' + (para.isHeadline ? ' headline' : '');

      for (let i = 0; i < para.words.length; i++) {
        const w = para.words[i];
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = w.word;
        span.dataset.start = w.start;
        span.dataset.end = w.end;
        if (w.translation) {
          span.dataset.translation = w.translation;
        }
        div.appendChild(span);

        // space between words
        if (i < para.words.length - 1) {
          div.appendChild(document.createTextNode(' '));
        }
      }

      transcript.appendChild(div);
    }
  }

  // Pre-build sorted array for binary search
  function buildWordIndex() {
    wordEntries = [];
    const spans = transcript.querySelectorAll('.word');
    for (const el of spans) {
      wordEntries.push({
        el: el,
        start: parseFloat(el.dataset.start),
        end: parseFloat(el.dataset.end)
      });
    }
    // Already in DOM order which is chronological, but sort to be safe
    wordEntries.sort(function (a, b) { return a.start - b.start; });
  }

  // --- Binary search for current word ---
  function findWordAtTime(t) {
    let lo = 0;
    let hi = wordEntries.length - 1;
    let result = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (wordEntries[mid].start <= t) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (result >= 0 && t < wordEntries[result].end) {
      return wordEntries[result];
    }
    return null;
  }

  // --- Highlight + auto-scroll ---
  function updateHighlight() {
    const t = audio.currentTime;
    const entry = findWordAtTime(t);

    if (entry && entry.el !== activeWord) {
      if (activeWord) activeWord.classList.remove('active');
      entry.el.classList.add('active');
      activeWord = entry.el;
      scrollToWord(entry.el);
    } else if (!entry && activeWord) {
      activeWord.classList.remove('active');
      activeWord = null;
    }
  }

  function scrollToWord(el) {
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight;
    // Only scroll if word is outside the middle 60% of viewport
    if (rect.top < viewH * 0.2 || rect.bottom > viewH * 0.7) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // --- Progress bar ---
  function updateProgress() {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = pct + '%';
    currentTimeEl.textContent = formatTime(audio.currentTime);
  }

  function seekFromEvent(e) {
    const rect = progressWrap.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = pct * audio.duration;
    updateProgress();
    updateHighlight();
  }

  // --- Play / Pause ---
  function togglePlay() {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }

  function syncPlayButton() {
    const playing = !audio.paused;
    iconPlay.classList.toggle('hidden', playing);
    iconPause.classList.toggle('hidden', !playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  // --- Translation popup ---
  let wasPlayingBeforePopup = false;

  function showPopup(wordEl) {
    var german = wordEl.textContent;
    var translation = wordEl.dataset.translation;
    if (!translation) {
      popupWord.textContent = german;
      popupTranslation.textContent = '(no translation)';
    } else {
      popupWord.textContent = german;
      popupTranslation.textContent = translation;
    }

    wasPlayingBeforePopup = !audio.paused;
    if (wasPlayingBeforePopup) audio.pause();

    popupOverlay.classList.add('visible');
    popup.classList.add('visible');
  }

  function hidePopup() {
    popupOverlay.classList.remove('visible');
    popup.classList.remove('visible');
    if (wasPlayingBeforePopup) {
      audio.play();
      wasPlayingBeforePopup = false;
    }
  }

  // --- Event listeners ---
  audio.addEventListener('timeupdate', function () {
    updateProgress();
    updateHighlight();
  });

  audio.addEventListener('loadedmetadata', function () {
    totalTimeEl.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('play', syncPlayButton);
  audio.addEventListener('pause', syncPlayButton);

  playBtn.addEventListener('click', togglePlay);

  // Progress bar seek (mouse)
  progressWrap.addEventListener('click', seekFromEvent);

  // Progress bar seek (touch drag)
  let seekingTouch = false;
  progressWrap.addEventListener('touchstart', function (e) {
    seekingTouch = true;
    seekFromEvent(e);
    e.preventDefault();
  });
  document.addEventListener('touchmove', function (e) {
    if (seekingTouch) seekFromEvent(e);
  });
  document.addEventListener('touchend', function () {
    seekingTouch = false;
  });

  // Word click → seek + translation
  transcript.addEventListener('click', function (e) {
    const wordEl = e.target.closest('.word');
    if (wordEl) {
      e.stopPropagation();
      audio.currentTime = parseFloat(wordEl.dataset.start);
      updateProgress();
      updateHighlight();
      showPopup(wordEl);
    }
  });

  // Dismiss popup on overlay click
  popupOverlay.addEventListener('click', hidePopup);

  // Dismiss popup on close pill click
  if (popupClose) popupClose.addEventListener('click', hidePopup);

  // Dismiss popup on outside click
  document.addEventListener('click', function (e) {
    if (!popup.contains(e.target) && !popupOverlay.contains(e.target) && !e.target.closest('.word')) {
      hidePopup();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    // Don't capture when typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    }
  });

  // --- Playback speed ---
  const speeds = [0.5, 0.75, 1.0, 1.25, 1.5];
  let speedIndex = 2; // start at 1.0×
  const speedBtn = document.getElementById('speed-btn');

  speedBtn.addEventListener('click', function () {
    speedIndex = (speedIndex + 1) % speeds.length;
    audio.playbackRate = speeds[speedIndex];
    speedBtn.textContent = speeds[speedIndex] + '×';
  });

  // --- Init ---
  document.addEventListener('DOMContentLoaded', loadEpisode);
})();
