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
  const skipBtn = document.getElementById('skip-btn');
  const helpBtn = document.getElementById('help-btn');

  // --- State ---
  let wordEntries = []; // { el, start, end }  sorted by start
  let activeWord = null;

  // Hold/tap detection
  var HOLD_MS = 400;
  var holdTimer = null;
  var isHolding = false;
  var holdTarget = null;
  var pressStartX = 0;
  var pressStartY = 0;
  var pressCancelled = false;
  var usedTouch = false;

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
    let id = getEpisodeId();
    if (!id) {
      try {
        const idx = await fetch('data/episodes.json');
        if (!idx.ok) throw new Error('Could not load episode list');
        const episodes = await idx.json();
        if (!episodes.length) throw new Error('No episodes available');
        id = String(episodes[0].id);
      } catch (err) {
        transcript.innerHTML = '<p class="error">No episodes available.</p>';
        console.error(err);
        return;
      }
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
      // ?coach=1 overrides localStorage dismissal
      var forceCoach = new URLSearchParams(window.location.search).has('coach');
      if (forceCoach) {
        localStorage.removeItem('wordsync-onboarding-dismissed');
        sessionStorage.removeItem('wordsync-onboarding-dismissed');
      }
      showCoachMarks(forceCoach);
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

  // --- Word interaction: tap to seek, hold to translate ---
  function wordPressStart(wordEl, x, y) {
    // Dismiss coach marks when user interacts with a non-coached word (they're exploring)
    if (document.body.classList.contains('coach-mode')) {
      var isCoached = wordEl.closest('.coach-word-wrap');
      if (!isCoached) dismissCoachMarks();
    }
    holdTarget = wordEl;
    pressCancelled = false;
    isHolding = false;
    pressStartX = x;
    pressStartY = y;
    holdTimer = setTimeout(function () {
      isHolding = true;
      showPopup(wordEl);
    }, HOLD_MS);
  }

  function pressMove(x, y) {
    if (isHolding) return;
    if (!holdTimer) return;
    if (Math.abs(x - pressStartX) > 10 || Math.abs(y - pressStartY) > 10) {
      clearTimeout(holdTimer);
      holdTimer = null;
      pressCancelled = true;
    }
  }

  function pressEnd() {
    clearTimeout(holdTimer);
    holdTimer = null;
    if (pressCancelled) { holdTarget = null; return; }
    if (isHolding) {
      hidePopup();
      isHolding = false;
    } else if (holdTarget) {
      var startTime = parseFloat(holdTarget.dataset.start);
      if (isFinite(startTime) && audio.readyState >= 1) {
        audio.currentTime = startTime;
        updateProgress();
        updateHighlight();
      }
    }
    holdTarget = null;
  }

  // Touch events (mobile)
  transcript.addEventListener('touchstart', function (e) {
    usedTouch = true;
    var wordEl = e.target.closest('.word');
    if (!wordEl) return;
    var t = e.touches[0];
    wordPressStart(wordEl, t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!holdTarget) return;
    var t = e.touches[0];
    pressMove(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (holdTarget) pressEnd();
  });

  // Mouse events (desktop — skipped on touch devices)
  transcript.addEventListener('mousedown', function (e) {
    if (usedTouch) return;
    var wordEl = e.target.closest('.word');
    if (!wordEl) return;
    e.preventDefault();
    wordPressStart(wordEl, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', function (e) {
    if (usedTouch || !holdTarget) return;
    pressMove(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', function () {
    if (usedTouch || !holdTarget) return;
    pressEnd();
  });

  // Prevent long-press context menu on words (Safari)
  transcript.addEventListener('contextmenu', function (e) {
    if (e.target.closest('.word')) e.preventDefault();
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

  // --- Skip forward 10s ---
  skipBtn.addEventListener('click', function () {
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
    updateProgress();
    updateHighlight();
  });

  // --- Inline coach marks ---
  var CURSOR_SVG = '<svg width="24" height="30" viewBox="0 0 24 30" fill="none">'
    + '<path d="M8.5 9V4a2 2 0 1 1 4 0v5m0 0V3a2 2 0 1 1 4 0v6m0 0V4.5a2 2 0 1 1 4 0V14'
    + 'c0 5-3.5 8.5-8 8.5h-1c-4 0-7-3.2-7-7.2V12a2 2 0 1 1 4 0V9" stroke="#1A1A1A"'
    + ' stroke-width="1.4" fill="#fff" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function pickCoachWords() {
    var allWords = transcript.querySelectorAll('.word[data-translation]');
    if (allWords.length < 6) return null;

    var holdWord = null;
    var tapWord = null;
    var holdParagraph = null;
    var count = 0;

    // Hold (translation) word first — it's the primary use case
    for (var i = 0; i < allWords.length; i++) {
      var w = allWords[i];
      var para = w.closest('.paragraph');
      if (para && para.classList.contains('headline')) continue;
      if (w.textContent.length < 4) continue;
      var trans = w.dataset.translation || '';
      count++;
      if (count === 3 && !holdWord && trans.length >= 4) {
        holdWord = w;
        holdParagraph = para;
      }
      // Tap word: same paragraph, spaced apart from hold word
      if (count >= 8 && !tapWord && holdWord && w !== holdWord && para === holdParagraph) {
        tapWord = w;
        break;
      }
    }

    // Fallback: relax constraints
    if (holdWord && !tapWord) {
      count = 0;
      for (var j = 0; j < allWords.length; j++) {
        var w2 = allWords[j];
        if (w2 === holdWord) continue;
        var para2 = w2.closest('.paragraph');
        if (para2 && para2.classList.contains('headline')) continue;
        if (w2.textContent.length < 4) continue;
        count++;
        if (count >= 6) { tapWord = w2; break; }
      }
    }

    if (!tapWord || !holdWord) return null;
    return { tap: tapWord, hold: holdWord };
  }

  function wrapWordWithCoach(wordEl, type) {
    var wrap = document.createElement('span');
    wrap.className = 'coach-word-wrap coach-' + type;
    wordEl.parentNode.insertBefore(wrap, wordEl);
    wrap.appendChild(wordEl);

    if (type === 'tap') {
      // Ripple
      var ripple = document.createElement('span');
      ripple.className = 'coach-ripple';
      wrap.appendChild(ripple);

      // Cursor with speaker badge
      var cursor = document.createElement('span');
      cursor.className = 'coach-cursor coach-tap-cursor';
      cursor.innerHTML = CURSOR_SVG
        + '<span class="coach-cursor-badge badge-tap"><svg width="12" height="12" viewBox="0 0 24 24" fill="#E63946" stroke="none"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg></span>';
      wrap.appendChild(cursor);

      // Callout
      var callout = document.createElement('span');
      callout.className = 'coach-callout callout-tap';
      callout.innerHTML = '<span class="coach-callout-card">'
        + '<span class="coach-callout-icon tap-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 19V5m0 0l-4 4m4-4l4 4"/></svg></span>'
        + '<span class="coach-callout-text"><strong>Tap any word</strong><span>Audio jumps to that word instantly</span></span>'
        + '</span>';
      wrap.appendChild(callout);

      // Connector
      var conn = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      conn.setAttribute('class', 'coach-connector conn-tap');
      conn.setAttribute('viewBox', '0 0 24 64');
      conn.setAttribute('fill', 'none');
      conn.innerHTML = '<path d="M2 62 Q2 30 22 18" stroke="#E63946" stroke-width="2" stroke-dasharray="4 3" opacity="0.45"/>';
      wrap.appendChild(conn);
    } else {
      // Hold ring
      var ring = document.createElement('span');
      ring.className = 'coach-hold-ring';
      wrap.appendChild(ring);

      // Cursor with translate badge
      var cursor2 = document.createElement('span');
      cursor2.className = 'coach-cursor coach-hold-cursor';
      cursor2.innerHTML = CURSOR_SVG
        + '<span class="coach-cursor-badge badge-hold"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1D3557" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M14 14l2 4 2-4"/><path d="M14.5 18h3.5"/></svg></span>';
      wrap.appendChild(cursor2);

      // Callout with inline translation preview
      var german = wordEl.textContent;
      var english = wordEl.dataset.translation || '…';
      var callout2 = document.createElement('span');
      callout2.className = 'coach-callout callout-hold';
      callout2.innerHTML = '<span class="coach-callout-card">'
        + '<span class="coach-callout-icon hold-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3m10-10h-3M5 12H2"/></svg></span>'
        + '<span class="coach-callout-text"><strong>Hold for translation</strong><span>Press &amp; hold — English meaning appears</span></span>'
        + '<span class="coach-callout-preview"><span class="coach-preview-de">' + german + '</span><span class="coach-preview-arrow">→</span><span class="coach-preview-en">' + english + '</span></span>'
        + '</span>';
      wrap.appendChild(callout2);

      // Connector
      var conn2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      conn2.setAttribute('class', 'coach-connector conn-hold');
      conn2.setAttribute('viewBox', '0 0 24 24');
      conn2.setAttribute('fill', 'none');
      conn2.innerHTML = '<path d="M2 2 Q2 18 22 22" stroke="#1D3557" stroke-width="2" stroke-dasharray="4 3" opacity="0.45"/>';
      wrap.appendChild(conn2);
    }

    return wrap;
  }

  var coachObserver = null;
  var coachAutoTimer = null;

  function showCoachMarks(force) {
    if (!force) {
      if (localStorage.getItem('wordsync-onboarding-dismissed')) return;
      if (sessionStorage.getItem('wordsync-onboarding-dismissed')) return;
    }

    var targets = pickCoachWords();
    if (!targets) return;

    wrapWordWithCoach(targets.tap, 'tap');
    wrapWordWithCoach(targets.hold, 'hold');

    document.body.classList.add('coach-mode');

    // Progressive reveal on first load; simultaneous on help (?)
    var holdWrap = transcript.querySelector('.coach-hold');
    var tapWrap = transcript.querySelector('.coach-tap');
    if (force) {
      // Both appear at once
      if (holdWrap) holdWrap.classList.add('coach-visible');
      if (tapWrap) tapWrap.classList.add('coach-visible');
    } else {
      // Hold (translation) first, then tap after a delay
      if (holdWrap) holdWrap.classList.add('coach-visible');
      setTimeout(function () {
        if (tapWrap) tapWrap.classList.add('coach-visible');
      }, 1400);
    }

    // Auto-dismiss after 12 seconds
    coachAutoTimer = setTimeout(function () {
      if (document.body.classList.contains('coach-mode')) dismissCoachMarks();
    }, 12000);

    // Scroll so both coach words are visible
    var tapWrap = transcript.querySelector('.coach-tap');
    var holdWrap = transcript.querySelector('.coach-hold');
    if (tapWrap && holdWrap) {
      var holdRect = holdWrap.getBoundingClientRect();
      // Scroll so hold word is ~35% from top (leaves room for callout above)
      var target = holdRect.top - window.innerHeight * 0.35;
      window.scrollBy({ top: target, behavior: 'smooth' });
    } else if (tapWrap) {
      tapWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // On mobile, use IntersectionObserver to show only the callout for the visible word
    setupCoachObserver();
  }

  function setupCoachObserver() {
    if (coachObserver) { coachObserver.disconnect(); coachObserver = null; }
    var tapWrap = transcript.querySelector('.coach-tap');
    var holdWrap = transcript.querySelector('.coach-hold');
    if (!tapWrap || !holdWrap) return;

    var tapCallout = tapWrap.querySelector('.coach-callout');
    var holdCallout = holdWrap.querySelector('.coach-callout');
    if (!tapCallout || !holdCallout) return;

    var tapVisible = false, holdVisible = false;

    function updateCallouts() {
      // On wide screens both show (they're absolutely positioned, no overlap)
      if (window.innerWidth > 900) {
        tapCallout.style.display = '';
        holdCallout.style.display = '';
        return;
      }
      // On mobile, show both when both visible; otherwise show whichever is in view
      if (tapVisible && holdVisible) {
        tapCallout.style.display = '';
        holdCallout.style.display = '';
      } else if (holdVisible) {
        tapCallout.style.display = 'none';
        holdCallout.style.display = '';
      } else {
        tapCallout.style.display = '';
        holdCallout.style.display = 'none';
      }
    }

    coachObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.target === tapWrap) tapVisible = entry.isIntersecting;
        if (entry.target === holdWrap) holdVisible = entry.isIntersecting;
      });
      updateCallouts();
    }, { threshold: 0.5 });

    coachObserver.observe(tapWrap);
    coachObserver.observe(holdWrap);
    updateCallouts();
  }

  function dismissCoachMarks() {
    localStorage.setItem('wordsync-onboarding-dismissed', '1');

    if (coachAutoTimer) { clearTimeout(coachAutoTimer); coachAutoTimer = null; }
    if (coachObserver) { coachObserver.disconnect(); coachObserver = null; }

    document.body.classList.remove('coach-mode');

    // Unwrap coached words back into their original position
    var wraps = transcript.querySelectorAll('.coach-word-wrap');
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var word = wrap.querySelector('.word');
      if (word) {
        wrap.parentNode.insertBefore(word, wrap);
      }
      wrap.remove();
    }
  }

  helpBtn.addEventListener('click', function () {
    if (document.body.classList.contains('coach-mode')) {
      dismissCoachMarks();
    }
    showCoachMarks(true);
  });

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function () {
    loadEpisode();
  });
})();
