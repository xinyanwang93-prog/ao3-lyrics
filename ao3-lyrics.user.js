// ==UserScript==
// @name         AO3 章节配乐与浮动歌词
// @namespace    ao3-chapter-lyrics
// @version      1.4.0
// @description  在指定 AO3 章节播放配乐，支持收起播放器、循环播放和按 LRC 时间戳逐字显示歌词。
// @match        https://archiveofourown.org/works/*
// @connect      xinyanwang93-prog.github.io
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const MEDIA_BASE = "https://xinyanwang93-prog.github.io/ao3-lyrics/media/";

  // 每条左侧填对应章的 AO3 路径。file 填 MP3、LRC 共用的文件名，不带扩展名。
  // 单章作品可以填 "/works/作品数字ID"。
  const CHAPTERS = {
    "/works/95113321/chapters/253989476": {
      title: "And Then is Heard No More",
      file: "Mili-And-Then-is-Heard-No-More",
    },
  };

  const hostId = "ao3-chapter-lyrics";
  const chapterPath = location.pathname.replace(/\/$/, "");
  const track = CHAPTERS[chapterPath];
  const chapters = document.querySelector("#workskin #chapters");
  if (!MEDIA_BASE || !track || !chapters || document.getElementById(hostId)) return;
  if (new URLSearchParams(location.search).get("view_full_work") === "true") return;

  const base = new URL(MEDIA_BASE.replace(/\/?$/, "/"));
  if (base.protocol !== "https:") return;
  const filename = encodeURIComponent(track.file);
  const mp3Url = new URL(filename + ".mp3", base).href;
  const lrcUrl = new URL(filename + ".lrc", base).href;

  const anchorPoints = [
    [.18, .16], [.82, .19], [.15, .47], [.85, .51],
    [.23, .80], [.77, .81], [.50, .32], [.50, .68],
  ];
  const longestAppearance = 5;
  const secondsPerCharacter = .055;
  const longestTyping = 1.6;
  const graphemeSegmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const prose = chapters.querySelector(".userstuff[role='article'], .userstuff.module");

  function readLyrics(text) {
    const timeTag = /\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/y;
    const offset = Number(text.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/im)?.[1] ?? 0);
    const entries = new Map();

    for (const row of text.split(/\r?\n/)) {
      const line = row.trim();
      const starts = [];
      timeTag.lastIndex = 0;
      let rest = 0;
      for (let match; (match = timeTag.exec(line));) {
        const fraction = (match[3] ?? "").padEnd(3, "0");
        const milliseconds = (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(fraction);
        starts.push(Math.max(0, milliseconds + offset) / 1000);
        rest = timeTag.lastIndex;
      }
      const lyric = line.slice(rest).trim();
      for (const start of starts) {
        const lines = entries.get(start) ?? [];
        if (lyric && lyric !== "//" && !lines.includes(lyric)) lines.push(lyric);
        entries.set(start, lines);
      }
    }

    const ordered = [...entries].sort(([left], [right]) => left - right);
    return ordered.map(([start, lines], index) => ({
      start,
      end: Math.min(start + longestAppearance, ordered[index + 1]?.[0] ?? Infinity),
      text: lines.join("\n"),
    }));
  }

  function locateCue(cues, time) {
    let low = 0;
    let high = cues.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cues[middle].start <= time) low = middle + 1;
      else high = middle;
    }
    const index = low - 1;
    return index >= 0 && cues[index].text && time < cues[index].end ? index : -1;
  }

  function randomPositions(cues, lastPlay) {
    let lastZone = -1;
    return cues.map((cue, index) => {
      if (!cue.text) return null;
      const available = anchorPoints.map((_, zone) => zone).filter(
        zone => zone !== lastZone && zone !== lastPlay[index]?.zone,
      );
      const zone = available[Math.floor(Math.random() * available.length)];
      const [x, y] = anchorPoints[zone];
      lastZone = zone;
      return {
        zone,
        x: x + (Math.random() - .5) * .09,
        y: y + (Math.random() - .5) * .07,
        angle: (Math.random() - .5) * 5,
      };
    });
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  const markup = `
    <style>
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        display: block;
        z-index: 10000;
        overflow: hidden;
        pointer-events: none;
        color-scheme: dark;
        font-family: system-ui, "Microsoft YaHei", sans-serif;
      }
      [hidden] { display: none !important; }
      .lyric {
        position: absolute;
        width: max-content;
        max-width: min(78vw, 36rem);
        color: #fff0d3;
        font: 700 clamp(1.2rem, 2.9vw, 2.65rem)/1.17 Georgia, "Songti SC", "SimSun", serif;
        direction: ltr;
        text-align: center;
        white-space: pre-line;
        overflow-wrap: anywhere;
        paint-order: stroke fill;
        -webkit-text-stroke: 1.6px #2a1611;
        text-shadow: 0 1px 4px #180f0e, 0 2px 16px #2b1912;
        opacity: 0;
        transform: translate(-50%, calc(-50% + var(--drift, 0px))) rotate(var(--angle, 0deg));
        pointer-events: none;
        user-select: none;
      }
      .lyric-character { opacity: 0; }
      .lyric-character.revealed { opacity: 1; }
      .player {
        position: absolute;
        right: max(12px, env(safe-area-inset-right));
        bottom: max(12px, env(safe-area-inset-bottom));
        box-sizing: border-box;
        max-width: calc(100% - 24px);
        padding: 7px;
        border: 1px solid #69574f;
        border-radius: 11px;
        background: #211a19;
        color: #f9e8d5;
        box-shadow: 0 4px 18px #0005;
        pointer-events: auto;
        font-size: .8125rem;
      }
      .controls { width: min(18rem, calc(100vw - 42px)); }
      .player-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 5px;
      }
      .title {
        min-width: 0;
        margin: 3px 3px 0;
        font-size: .875rem;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      audio { display: block; width: 100%; height: 42px; }
      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
        padding-top: 5px;
      }
      button {
        border: 1px solid #786357;
        border-radius: 5px;
        padding: 5px 8px;
        background: #372a25;
        color: #f9e8d5;
        font: inherit;
        cursor: pointer;
      }
      .collapse { flex: none; padding: 3px 6px; }
      .start, .expand, .loop-toggle[aria-pressed="true"] {
        background: #f7d9b3;
        color: #2a1b11;
        font-weight: 650;
      }
      button:disabled { opacity: .75; cursor: wait; }
      button:focus-visible { outline: 2px solid #ffdc93; outline-offset: 2px; }
      .status { max-width: 17rem; margin: 5px 3px 0; color: #ffdbab; }
    </style>
    <div class="lyric" aria-hidden="true" hidden></div>
    <div class="player" role="group" aria-label="章节配乐">
      <button type="button" class="start" disabled>正在读取歌词…</button>
      <button type="button" class="expand" aria-controls="ao3-lyrics-controls" aria-expanded="false" hidden>展开播放器</button>
      <div class="controls" id="ao3-lyrics-controls" hidden>
        <div class="player-heading">
          <p class="title"></p>
          <button type="button" class="collapse" aria-controls="ao3-lyrics-controls" aria-expanded="true">收起播放器</button>
        </div>
        <audio controls preload="none"></audio>
        <div class="actions">
          <button type="button" class="replay">从头播放</button>
          <button type="button" class="loop-toggle" aria-pressed="false">
            循环播放 <span class="loop-state" aria-hidden="true">关</span>
          </button>
          <button type="button" class="lyric-toggle">隐藏歌词</button>
          <button type="button" class="close">停止并收起</button>
        </div>
      </div>
      <p class="status" role="status" hidden></p>
    </div>`;

  const host = document.createElement("div");
  host.id = hostId;
  const layer = host.attachShadow({ mode: "open" });
  layer.innerHTML = markup;
  const player = layer.querySelector(".player");
  const start = layer.querySelector(".start");
  const expand = layer.querySelector(".expand");
  const collapse = layer.querySelector(".collapse");
  const controls = layer.querySelector(".controls");
  const sound = layer.querySelector("audio");
  const title = layer.querySelector(".title");
  const replay = layer.querySelector(".replay");
  const loopToggle = layer.querySelector(".loop-toggle");
  const loopState = layer.querySelector(".loop-state");
  const lyricToggle = layer.querySelector(".lyric-toggle");
  const close = layer.querySelector(".close");
  const status = layer.querySelector(".status");
  const lyric = layer.querySelector(".lyric");

  title.textContent = track.title;
  sound.setAttribute("aria-label", track.title);
  start.title = track.title;
  document.body.append(host);

  let cues = [];
  let positions = [];
  let activeIndex = -1;
  let animationFrame = 0;
  let playerView = "closed";
  let started = false;
  let shuffleOnPlay = false;
  let showLyrics = true;
  let lyricCharacters = [];
  let revealedCharacters = 0;

  function positionLyric() {
    if (activeIndex < 0) return;
    const { x, y, angle } = positions[activeIndex];
    const { width, left: stageLeft, top: stageTop } = host.getBoundingClientRect();
    const height = Math.max(0, player.getBoundingClientRect().top - stageTop - 10);
    const column = prose?.getBoundingClientRect();
    let left = 0;
    let right = width;

    // 宽屏优先在正文两侧留白显示。窄屏使用屏幕内的同一组随机区域。
    if (column && x < .4 && column.left - stageLeft >= 220) {
      right = column.left - stageLeft - 10;
    }
    if (column && x > .6 && stageLeft + width - column.right >= 220) {
      left = column.right - stageLeft + 10;
    }
    lyric.style.maxWidth = left === 0 && right === width ? "" : (right - left - 28) + "px";
    const edgeX = Math.min((right - left) / 2, lyric.offsetWidth / 2 + 14);
    const edgeY = Math.min(height / 2, lyric.offsetHeight / 2 + 28);
    lyric.style.left = clamp(x * width, left + edgeX, right - edgeX) + "px";
    lyric.style.top = clamp(y * height, edgeY, height - edgeY) + "px";
    lyric.style.setProperty("--angle", (reducedMotion.matches ? 0 : angle) + "deg");
    lyric.style.visibility = height > lyric.offsetHeight + 18 ? "visible" : "hidden";
  }

  function clearLyric() {
    if (activeIndex < 0) return;
    activeIndex = -1;
    lyric.hidden = true;
    lyric.replaceChildren();
    lyricCharacters = [];
    revealedCharacters = 0;
  }

  function setLyricText(text) {
    const graphemes = graphemeSegmenter
      ? Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment)
      : Array.from(text);
    lyricCharacters = graphemes.map(grapheme => {
      const character = document.createElement("span");
      character.className = "lyric-character";
      character.textContent = grapheme;
      return character;
    });
    // 先让整句占好位置，再逐字显示。
    lyric.replaceChildren(...lyricCharacters);
    revealedCharacters = 0;
  }

  function updateTypewriter(age, cueDuration) {
    const count = lyricCharacters.length;
    const typingDuration = Math.min((count - 1) * secondsPerCharacter, longestTyping, cueDuration * .6);
    const visible = reducedMotion.matches || typingDuration <= 0
      ? count
      : Math.min(count, 1 + Math.floor(age / typingDuration * (count - 1)));
    const from = Math.min(visible, revealedCharacters);
    const until = Math.max(visible, revealedCharacters);
    for (let index = from; index < until; index++) {
      lyricCharacters[index].classList.toggle("revealed", index < visible);
    }
    revealedCharacters = visible;
  }

  function drawLyric() {
    if (!started || !showLyrics || sound.seeking || sound.ended || playerView === "closed") {
      clearLyric();
      return;
    }
    const time = sound.currentTime;
    const index = locateCue(cues, time);
    if (index < 0) {
      clearLyric();
      return;
    }

    const cue = cues[index];
    if (index !== activeIndex) {
      activeIndex = index;
      setLyricText(cue.text);
      lyric.hidden = false;
      positionLyric();
    }
    const age = time - cue.start;
    const span = cue.end - cue.start;
    updateTypewriter(age, span);
    const fadeIn = Math.min(.19, span / 4);
    const fadeOut = Math.min(.37, span / 3);
    const opacity = reducedMotion.matches
      ? 1
      : clamp(Math.min(age / fadeIn, (span - age) / fadeOut), 0, 1);
    lyric.style.opacity = String(.97 * opacity);
    lyric.style.setProperty("--drift", (reducedMotion.matches ? 0 : -20 * age / span) + "px");
  }

  function tick() {
    animationFrame = 0;
    drawLyric();
    if (!sound.paused && !sound.ended) animationFrame = requestAnimationFrame(tick);
  }

  function stopTick() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    drawLyric();
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = message === "";
  }

  function setPlayerView(view) {
    playerView = view;
    start.hidden = view !== "closed";
    expand.hidden = view !== "collapsed";
    controls.hidden = view !== "expanded";
  }

  function resetPositions() {
    positions = randomPositions(cues, positions);
    shuffleOnPlay = false;
    clearLyric();
  }

  function loadLyrics() {
    start.disabled = true;
    start.textContent = "正在读取歌词…";
    showStatus("");
    let settled = false;

    function failed() {
      if (settled) return;
      settled = true;
      start.textContent = "重试读取歌词";
      start.disabled = false;
      showStatus("歌词读取失败。请检查 LRC 文件地址和脚本管理器的站点权限。");
    }

    function loaded(response) {
      if (settled) return;
      if (!(response?.status >= 200 && response.status < 300)) {
        failed();
        return;
      }
      const text = response.responseText ?? response.response;
      const parsed = typeof text === "string" ? readLyrics(text) : [];
      if (!parsed.some(cue => cue.text)) {
        failed();
        return;
      }
      settled = true;
      cues = parsed;
      resetPositions();
      start.textContent = "播放配乐";
      start.disabled = false;
    }

    try {
      const request = {
        method: "GET",
        url: lrcUrl,
        responseType: "text",
        anonymous: true,
        timeout: 15000,
        onload: loaded,
        onerror: failed,
        ontimeout: failed,
        onabort: failed,
      };
      if (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function") {
        // Userscripts 和近期 Tampermonkey 支持此接口。
        GM.xmlHttpRequest(request)?.then?.(loaded, failed);
      } else {
        GM_xmlhttpRequest(request);
      }
    } catch {
      failed();
    }
  }

  async function playTrack() {
    try {
      await sound.play();
    } catch (error) {
      if (error.name === "AbortError" || playerView === "closed") return;
      showStatus(error.name === "NotAllowedError"
        ? "请点播放器的播放键继续。"
        : "音频无法播放。请检查 MP3 直链，或停止播放后重试。");
    }
  }

  function restartTrack() {
    resetPositions();
    sound.currentTime = 0;
    playTrack();
  }

  start.addEventListener("click", () => {
    if (!cues.length) {
      loadLyrics();
      return;
    }
    showStatus("");
    setPlayerView("expanded");
    if (!sound.hasAttribute("src")) sound.src = mp3Url;
    playTrack();
    sound.focus({ preventScroll: true });
  });

  collapse.addEventListener("click", () => {
    setPlayerView("collapsed");
    expand.focus({ preventScroll: true });
  });

  expand.addEventListener("click", () => {
    setPlayerView("expanded");
    collapse.focus({ preventScroll: true });
  });

  replay.addEventListener("click", restartTrack);

  loopToggle.addEventListener("click", () => {
    const enabled = loopToggle.getAttribute("aria-pressed") !== "true";
    loopToggle.setAttribute("aria-pressed", String(enabled));
    loopState.textContent = enabled ? "开" : "关";
  });

  lyricToggle.addEventListener("click", () => {
    showLyrics = !showLyrics;
    lyricToggle.textContent = showLyrics ? "隐藏歌词" : "显示歌词";
    drawLyric();
  });

  close.addEventListener("click", () => {
    setPlayerView("closed");
    sound.pause();
    sound.currentTime = 0;
    started = false;
    shuffleOnPlay = true;
    showStatus("");
    stopTick();
    start.focus({ preventScroll: true });
  });

  sound.addEventListener("play", () => {
    if (shuffleOnPlay) resetPositions();
  });
  sound.addEventListener("playing", () => {
    if (playerView === "closed") return;
    started = true;
    showStatus("");
    if (!animationFrame) animationFrame = requestAnimationFrame(tick);
  });
  sound.addEventListener("pause", stopTick);
  sound.addEventListener("ended", () => {
    if (!sound.ended) return;
    started = false;
    shuffleOnPlay = true;
    stopTick();
    if (playerView !== "closed" && loopToggle.getAttribute("aria-pressed") === "true") {
      restartTrack();
    }
  });
  sound.addEventListener("error", () => {
    if (!sound.hasAttribute("src")) return;
    started = false;
    setPlayerView("closed");
    sound.removeAttribute("src");
    sound.load();
    showStatus("音频读取失败。请检查 MP3 直链，再点播放配乐。");
    stopTick();
  });
  for (const event of ["timeupdate", "seeking", "seeked"]) {
    sound.addEventListener(event, drawLyric);
  }
  new ResizeObserver(positionLyric).observe(player);
  window.addEventListener("resize", positionLyric);
  window.addEventListener("pagehide", () => sound.pause());
  document.addEventListener("visibilitychange", drawLyric);
  reducedMotion.addEventListener("change", () => {
    positionLyric();
    drawLyric();
  });
  loadLyrics();
})();
