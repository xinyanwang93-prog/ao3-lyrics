// ==UserScript==
// @name         AO3 章节配乐与浮动歌词
// @namespace    ao3-chapter-lyrics
// @version      1.9.2
// @description  在 AO3 章节显示同步配乐与浮动歌词，支持点击正文播放照片动画。
// @match        https://archiveofourown.org/works/*
// @match        https://www.ao3-cn.com/works/*
// @connect      xinyanwang93-prog.github.io
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// @updateURL    https://xinyanwang93-prog.github.io/ao3-lyrics/ao3-lyrics.user.js
// @downloadURL  https://xinyanwang93-prog.github.io/ao3-lyrics/ao3-lyrics.user.js
// ==/UserScript==

(() => {
  "use strict";

  const MEDIA_BASE = "https://xinyanwang93-prog.github.io/ao3-lyrics/media/";

  // AO3 preset editor format 3
  const CHAPTERS = {
    "/works/95113321/chapters/253989476": {
      "id": "legacy:/works/95113321/chapters/253989476:0",
      "title": "And Then is Heard No More",
      "audio": "Mili-And-Then-is-Heard-No-More.mp3",
      "lyrics": "Mili-And-Then-is-Heard-No-More.lrc",
      "triggerText": "这便是他们需要面对的现实。"
    },
    "/works/95113321/chapters/254491486": {
      "id": "32802e09-a125-453a-8adb-965240c2878b",
      "title": "And Then is Heard No More",
      "audio": "Mili-And-Then-is-Heard-No-More.mp3",
      "lyrics": "Mili-And-Then-is-Heard-No-More.lrc",
      "triggerText": ""
    }
  };

  // BEGIN AO3 chapter animations
  const ANIMATIONS = {
    "/works/63298294/chapters/197819821": {
      "id": "ca668fd2-86b9-4108-9bd0-954464c2f13d",
      "title": "拍立得1",
      "templateId": "polaroid",
      "image": "uploads/0e1f0eb53305693020a1d34d/微信图片_20261113234719_50_18.png",
      "blackHoldSeconds": 1,
      "revealSeconds": 3,
      "triggerText": "茄子"
    }
  };
  queueMicrotask(() => installChapterAnimations(ANIMATIONS, MEDIA_BASE));

  function installChapterAnimations(config, mediaBase) {
    const path = location.pathname.replace(/\/$/, "");
    const entry = config[path];
    if (!entry || new URLSearchParams(location.search).get("view_full_work") === "true") return;
    const chapters = document.querySelector("#workskin #chapters");
    if (!chapters) {
      const waiting = new MutationObserver(()=>{
        if (!document.querySelector("#workskin #chapters")) return;
        waiting.disconnect();
        installChapterAnimations(config,mediaBase);
      });
      waiting.observe(document.documentElement,{childList:true,subtree:true});
      return;
    }
    if (chapters.hasAttribute("data-ao3-photo-events")) return;
    const triggers = (Array.isArray(entry) ? entry : [entry]).map(preset => ({
      preset, needle:(preset.triggerText || "").replace(/\s/g,"")
    })).filter(item => item.needle && item.preset.image);
    if (!triggers.length) return;
    // Bind longer phrases first when two phrases overlap at the same point.
    triggers.sort((left,right)=>right.needle.length-left.needle.length);
    const actions = new Map(triggers.map(({preset})=>[preset.id,preset]));
    const selector = "[data-ao3-photo-trigger]";
    const excluded = "a,button,input,textarea,select,summary,script,style,noscript,template,[hidden],[aria-hidden='true'],[contenteditable]:not([contenteditable='false']),.landmark,.preface,.notes,.summary,.end.notes";
    const proseSelector = ".userstuff[role='article'], .userstuff.module, .chapter > .userstuff, #chapters > .userstuff";
    const style = document.createElement("style");
    style.textContent = `
      #workskin [data-ao3-photo-trigger]{color:var(--ao3-photo-ink,#155eae)!important;cursor:pointer!important;text-decoration:underline!important;text-decoration-thickness:1px!important;text-underline-offset:.16em;border-radius:2px}
      #workskin [data-ao3-photo-trigger]:focus-visible{outline:2px solid currentColor!important;outline-offset:3px}
      @media(forced-colors:active){#workskin [data-ao3-photo-trigger]{color:LinkText!important}}
    `;
    (document.head || document.documentElement).append(style);
    chapters.setAttribute("data-ao3-photo-events","true");

    function blueInk(parent) {
      for (let el=parent; el; el=el.parentElement) {
        const color = getComputedStyle(el).backgroundColor;
        const rgba = color.match(/[\d.]+/g);
        if (!rgba || rgba.length < 3 || (rgba[3] !== undefined && Number(rgba[3]) < .5)) continue;
        const [r,g,b] = rgba.map(Number);
        return (.2126*r + .7152*g + .0722*b) < 125 ? "#9ccfff" : "#155eae";
      }
      return getComputedStyle(parent).colorScheme === "dark" ? "#9ccfff" : "#155eae";
    }
    function proseGroups(root) {
      const groups = [];
      const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let group = null;
      for (let node; (node = walker.nextNode());) {
        const parent = node.parentElement;
        if (!parent || parent.closest(excluded)) { group = null; continue; }
        const chunk = node.data.replace(/\s/g,"");
        if (!chunk) continue;
        const block = parent.closest("p,li,blockquote,div,td,th,pre,h1,h2,h3,h4,h5,h6,figcaption") || root;
        if (group?.block !== block) {
          group = {block,text:"",parts:[],occupied:[]};
          groups.push(group);
        }
        const start = group.text.length;
        group.text += chunk;
        group.parts.push({ node, start, end:group.text.length });
      }
      return groups;
    }
    function collectPieces(groups) {
      const pieces = new Map();
      for (const {preset,needle} of triggers) {
        let matched = false;
        for (const group of groups) {
          let from = 0;
          while (!matched) {
            const start = group.text.indexOf(needle,from);
            if (start === -1) break;
            const end = start + needle.length;
            if (group.occupied.some(item=>start < item.end && end > item.start)) { from = start + 1; continue; }
            group.occupied.push({start,end});
            let first = true;
            for (const part of group.parts) {
              if (part.start >= end) break;
              if (part.end <= start) continue;
              const offsets = [];
              for (let i=0; i<part.node.length; i++) if (!/\s/.test(part.node.data[i])) offsets.push(i);
              const left = offsets[Math.max(0,start-part.start)];
              const right = offsets[Math.min(part.end,end)-part.start-1]+1;
              if (!pieces.has(part.node)) pieces.set(part.node,[]);
              pieces.get(part.node).push({left,right,first,preset});
              first = false;
            }
            matched = true;
          }
          if (matched) break;
        }
      }
      return pieces;
    }
    function refresh() {
      observer.disconnect();
      try {
        for (const old of chapters.querySelectorAll(selector)) old.replaceWith(...old.childNodes);
        let scope = proseSelector;
        let candidates = [...chapters.querySelectorAll(scope)];
        if (!candidates.length) { scope = ".userstuff"; candidates = [...chapters.querySelectorAll(scope)]; }
        const roots = candidates.filter(root =>
          !root.closest(".preface,.notes,.summary,[hidden]") && !root.parentElement?.closest(scope));
        const pieces = collectPieces(roots.flatMap(proseGroups));
        for (const [node,list] of pieces) {
          const ink = blueInk(node.parentElement);
          for (const part of list.sort((a,b)=>b.left-a.left)) {
            if (part.right < node.length) node.splitText(part.right);
            const matched = part.left ? node.splitText(part.left) : node;
            const mark = document.createElement("span");
            mark.dataset.ao3PhotoTrigger = part.preset.id;
            mark.style.setProperty("--ao3-photo-ink",ink);
            if (part.first) {
              mark.setAttribute("role","button"); mark.tabIndex = 0;
              mark.setAttribute("aria-haspopup","dialog");
              mark.setAttribute("aria-label",part.preset.triggerText+"，打开照片");
            } else mark.setAttribute("aria-hidden","true");
            matched.replaceWith(mark); mark.append(matched);
          }
        }
      } finally { observer.observe(chapters,{childList:true,characterData:true,attributes:true,attributeFilter:["hidden","aria-hidden","class","role"],subtree:true}); }
    }
    function fetchPhoto(url) {
      return new Promise((resolve,reject)=>{
        const loaded = event => {
          if (event?.status >= 200 && event.status < 300 && event.response?.size) resolve(event.response);
          else reject(Error("无法读取照片"));
        };
        const request = {method:"GET",url,responseType:"blob",anonymous:true,timeout:15000,
          onload:loaded,onerror:reject,ontimeout:reject,onabort:reject};
        if (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function") {
          GM.xmlHttpRequest(request)?.then?.(loaded,reject);
        } else if (typeof GM_xmlhttpRequest === "function") GM_xmlhttpRequest(request);
        else reject(Error("无法读取照片"));
      });
    }
    function activate(event) {
      if (location.pathname.replace(/\/$/,"") !== path || new URLSearchParams(location.search).get("view_full_work") === "true") return;
      const mark = event.target.closest?.(selector);
      if (!mark || !chapters.contains(mark)) return;
      if (event.type === "keydown" && (event.repeat || (event.key !== "Enter" && event.key !== " "))) return;
      if (event.type === "click" && window.getSelection()?.isCollapsed === false) return;
      const preset = actions.get(mark.dataset.ao3PhotoTrigger);
      if (!preset) return;
      event.preventDefault();
      const url = new URL(preset.image.split("/").map(encodeURIComponent).join("/"),mediaBase).href;
      const opener = mark.tabIndex === 0 ? mark : [...chapters.querySelectorAll(selector)].find(
        part=>part.tabIndex===0 && part.dataset.ao3PhotoTrigger===preset.id);
      openChapterPhoto({preset,url,opener,fallback:()=>fetchPhoto(url)});
    }
    let scheduled = false;
    const observer = new MutationObserver(()=>{
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(()=>{scheduled=false;refresh();});
    });
    chapters.addEventListener("click",activate);
    chapters.addEventListener("keydown",activate);
    refresh();
  }

  function photoTiming(preset, validate = false) {
    if (preset.templateId !== "polaroid") return {};
    function seconds(raw, defaultValue, label) {
      if (raw == null) return defaultValue;
      const value = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : NaN;
      if (Number.isFinite(value) && value >= 0 && value * 1000 <= 2147483647) return value;
      if (validate) {
        if (value * 1000 > 2147483647) throw Error(label + "超出浏览器可计时的范围。");
        throw Error("请填写有效的" + label + "。秒数须大于或等于 0，可使用小数。");
      }
      return defaultValue;
    }
    return {
      blackHoldSeconds: seconds(preset.blackHoldSeconds, 8, "黑屏停留时间"),
      revealSeconds: seconds(preset.revealSeconds, 2, "显影持续时间")
    };
  }

  function openChapterPhoto({ preset, url, opener, fallback, release }) {
    // AO3 photo viewer revision 2
    const hostId = "ao3-chapter-photo-viewer";
    if (document.getElementById(hostId)) { release?.(); return; }
    const host = document.createElement("div");
    host.id = hostId;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;color-scheme:light}
        *,*::before,*::after{box-sizing:border-box}
        dialog{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:0;overflow:hidden;color:#29231f;background:rgba(20,15,19,.48);font:14px/1.4 system-ui,"Microsoft YaHei",sans-serif;pointer-events:auto;overscroll-behavior:contain;touch-action:pinch-zoom}
        dialog[open]{display:grid;place-items:center}dialog::backdrop{background:transparent}
        .flash{position:absolute;inset:0;background:#fff;z-index:2;pointer-events:none}
        .flash.fire{animation:ao3-shutter 180ms ease-out both}
        @keyframes ao3-shutter{0%,12%{opacity:1}100%{opacity:0}}
        figure{position:relative;display:grid;grid-template-rows:auto auto;margin:0;min-width:0;padding:0 clamp(9px,2.15vw,19px) clamp(18px,3.6vw,36px);background:linear-gradient(135deg,#fffdf6,#f1ecdf);color:#302823;border:1px solid #e4ded2;border-radius:3px;box-shadow:0 18px 56px #17101666,0 2px 8px #17101633}
        .bar{min-height:32px;display:flex;align-items:center;justify-content:space-between;gap:8px}
        .close{font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;color:#3d3330;background:transparent;border:0;border-radius:4px;min-height:32px;min-width:42px;padding:2px 6px;white-space:nowrap}.close:hover{background:#ddd5ca}.close:focus-visible{outline:2px solid #245f9e}
        .status{margin:0;font-size:12px;color:#61544d;overflow-wrap:anywhere}
        .well{position:relative;overflow:hidden;background:#000}
        img{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-orientation:from-image;opacity:0}
        .loading{margin:0;padding:.55em .95em;color:white;background:#282222de;border-radius:5px}
        dialog[data-template=polaroid]{
          --view-height:100vh;
          --edge-x:max(15px,env(safe-area-inset-left,0px),env(safe-area-inset-right,0px));
          --edge-y:max(12px,env(safe-area-inset-top,0px),env(safe-area-inset-bottom,0px));
          --side:clamp(9px,2.15vw,19px);--bottom:clamp(18px,3.6vw,36px);--toolbar:32px;
          --paper-limit:min(690px,calc(100vw - 2 * var(--edge-x)));
          --room-width:max(1px,calc(var(--paper-limit) - 2 * var(--side) - 2px));
          --room-height:max(1px,calc(var(--view-height) - 2 * var(--edge-y) - var(--toolbar) - var(--bottom) - 2px));
          height:var(--view-height)
        }
        dialog[data-template=polaroid] figure{
          --opening-width:min(var(--room-width),calc(var(--room-height) * var(--photo-ratio,1)));
          width:calc(max(var(--opening-width),min(60px,var(--room-width))) + 2 * var(--side) + 2px);
          padding:0 var(--side) var(--bottom);grid-template-columns:minmax(0,1fr);grid-template-rows:var(--toolbar) auto
        }
        dialog[data-template=polaroid] .well{justify-self:center;width:var(--opening-width);aspect-ratio:var(--photo-ratio,1)}
        dialog[data-template=polaroid] .close{flex:none}
        dialog[data-template=polaroid]:not([data-load-error]) .status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        dialog[data-template=polaroid][data-load-error] figure{width:min(320px,var(--paper-limit));grid-template-rows:auto;padding:6px var(--side)}
        dialog[data-template=polaroid][data-load-error] .well{display:none}
        dialog[data-template=album] figure{width:min(690px,calc(100vw - 30px),calc(164vh - 130px));background:#f8f6f4;border-radius:8px;padding-bottom:clamp(10px,2vw,18px)}
        dialog[data-template=album] .well{width:100%;aspect-ratio:16/9;border-radius:3px;background:#282524}
        [hidden]{display:none!important}
        @supports(height:100dvh){dialog[data-template=polaroid]{--view-height:100dvh}dialog[data-template=album] figure{width:min(690px,calc(100vw - 30px),calc(164dvh - 130px))}}
        @media(pointer:coarse){dialog[data-template=polaroid]{--toolbar:42px}.bar,.close{min-height:42px}.close{min-width:44px}}
      </style>
      <dialog tabindex="-1" aria-label="章节照片"><div class="flash" hidden></div><p class="loading" role="status" hidden>正在载入照片…</p>
        <figure hidden><div class="bar"><p class="status" role="status"></p><button class="close" type="button" aria-label="关闭照片" hidden>× 关闭</button></div>
          <div class="well"><img alt="" draggable="false"></div></figure>
      </dialog>`;
    const dialog = root.querySelector("dialog");
    const flash = root.querySelector(".flash"), paper = root.querySelector("figure");
    const loading = root.querySelector(".loading");
    const image = root.querySelector("img"), close = root.querySelector(".close"), status = root.querySelector(".status");
    const polaroid = preset.templateId === "polaroid";
    const timing = photoTiming(preset);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dialog.dataset.template = preset.templateId;
    image.alt = preset.title || (polaroid ? "拍立得照片" : "相册照片");
    const timers = new Set();
    let active = true, ready = false, holdEnded = false, revealing = false, failed = false;
    let usedFallback = false, fallbackURL = null, effect = null;
    function later(fn, ms) {
      const timer = setTimeout(() => { timers.delete(timer); if (active) fn(); }, ms);
      timers.add(timer);
      return timer;
    }
    function dismiss() {
      if (!active) return;
      active = false;
      for (const timer of timers) clearTimeout(timer);
      effect?.cancel();
      image.onload = image.onerror = null;
      image.removeAttribute("src");
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      window.removeEventListener("pagehide", dismiss);
      host.remove();
      release?.();
      if (fallbackURL) URL.revokeObjectURL(fallbackURL);
      if (opener?.isConnected) opener.focus({preventScroll:true});
    }
    function showClose() {
      close.hidden = false;
      if (dialog.matches(":focus-within") || root.activeElement === dialog) close.focus({preventScroll:true});
    }
    function showError() {
      if (!active || ready || failed) return;
      failed = true;
      dialog.dataset.loadError = "true";
      loading.hidden = true; flash.hidden = true; paper.hidden = false;
      status.textContent = "照片未能载入。关闭后可再次点击正文重试。";
      showClose();
    }
    function reveal() {
      if (!active || !ready || !holdEnded || revealing || failed) return;
      revealing = true;
      status.textContent = "";
      const fullDuration = polaroid ? timing.revealSeconds * 1000 : 1450;
      const duration = reduced ? Math.min(160,fullDuration) : fullDuration;
      const first = polaroid || reduced ? { opacity:0 } : { opacity:0, filter:"blur(9px)", transform:"scale(1.035)" };
      const final = { opacity:1, filter:"none", transform:"none" };
      const finish = () => {
        if (!active) return;
        image.style.opacity = "1"; image.style.filter = "none"; image.style.transform = "none";
        effect?.cancel(); effect = null;
        showClose();
      };
      if (duration === 0) { finish(); return; }
      if (typeof image.animate === "function") {
        effect = image.animate([first,final],{duration,easing:"ease-in-out",fill:"both"});
        effect.finished.then(finish,()=>{});
      } else {
        Object.assign(image.style,first);
        image.getBoundingClientRect();
        image.style.transition = `opacity ${duration}ms ease-in-out, filter ${duration}ms, transform ${duration}ms`;
        Object.assign(image.style,final);
        later(finish,duration);
      }
    }
    function presentPaper() {
      if (failed || !flash.hidden) return;
      if (polaroid) {
        if (!image.naturalWidth || !image.naturalHeight) { if (paper.hidden) loading.hidden = false; return; }
        paper.style.setProperty("--photo-ratio",String(image.naturalWidth / image.naturalHeight));
      }
      if (!paper.hidden) return;
      loading.hidden = true;
      paper.hidden = false;
      function endHold() {
        holdEnded = true;
        if (!ready) status.textContent = "正在载入照片…";
        reveal();
      }
      if (polaroid && timing.blackHoldSeconds > 0) later(endHold,timing.blackHoldSeconds * 1000);
      else endHold();
    }
    close.addEventListener("click",dismiss);
    dialog.addEventListener("cancel",event=>{ event.preventDefault(); dismiss(); });
    dialog.addEventListener("keydown",event=>{ if(event.key==="Escape"){event.preventDefault();dismiss();} });
    dialog.addEventListener("close",dismiss);
    dialog.addEventListener("wheel",event=>{ if(!event.ctrlKey) event.preventDefault(); },{passive:false});
    window.addEventListener("pagehide",dismiss);
    document.body.append(host);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else { dialog.setAttribute("open",""); dialog.setAttribute("aria-modal","true"); }
    dialog.focus({preventScroll:true});
    if (polaroid && !reduced) {
      flash.hidden = false; flash.className = "flash fire";
      later(()=>{flash.hidden = true; presentPaper();},180);
    }
    else presentPaper();
    const loadTimeout = later(showError,25000);
    image.onload = () => {
      if (!active || failed) return;
      if (polaroid && (!image.naturalWidth || !image.naturalHeight)) { showError(); return; }
      clearTimeout(loadTimeout); timers.delete(loadTimeout);
      ready = true; presentPaper(); reveal();
    };
    image.onerror = async () => {
      if (!active || failed) return;
      if (!fallback || usedFallback) { showError(); return; }
      usedFallback = true;
      try {
        const blob = await fallback();
        if (!active || failed) return;
        fallbackURL = URL.createObjectURL(blob); image.src = fallbackURL;
      } catch { showError(); }
    };
    image.referrerPolicy = "no-referrer";
    image.src = url;
  }
  // END AO3 chapter animations

  const hostId = "ao3-chapter-lyrics";
  const chapterPath = location.pathname.replace(/\/$/, "");
  const chapterEntry = CHAPTERS[chapterPath];
  const chapters = document.querySelector("#workskin #chapters");
  if (!MEDIA_BASE || !chapterEntry || !chapters || document.getElementById(hostId)) return;
  if (new URLSearchParams(location.search).get("view_full_work") === "true") return;

  const base = new URL(MEDIA_BASE.replace(/\/?$/, "/"));
  if (base.protocol !== "https:") return;
  const tracks = Array.isArray(chapterEntry) ? chapterEntry : [chapterEntry];

  function mediaUrl(path) {
    const parts = path.split("/");
    if (parts.some(part => !part || part === "." || part === "..")) throw new Error("无效的媒体路径");
    return new URL(parts.map(encodeURIComponent).join("/"), base).href;
  }

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
  function findTriggerRanges(root, triggerText) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement.closest("script, style, noscript, template, [hidden]")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const parts = [];
    let text = "";
    for (let node; (node = walker.nextNode());) {
      const content = node.data.replace(/\s/g, "");
      parts.push({ node, start: text.length, length: content.length });
      text += content;
    }

    const start = text.indexOf(triggerText);
    if (start < 0) return [];
    const end = start + triggerText.length;
    const ranges = [];
    for (const part of parts) {
      if (part.start >= end) break;
      if (!part.length || part.start + part.length <= start) continue;
      const offsets = [];
      for (let offset = 0; offset < part.node.data.length; offset++) {
        if (!/\s/.test(part.node.data[offset])) offsets.push(offset);
      }
      const from = Math.max(0, start - part.start);
      const until = Math.min(part.length, end - part.start);
      const range = document.createRange();
      range.setStart(part.node, offsets[from]);
      range.setEnd(part.node, offsets[until - 1] + 1);
      ranges.push(range);
    }
    return ranges;
  }

  function waitForTriggerText(track) {
    const triggerText = (track.triggerText ?? "").replace(/\s/g, "");
    if (!triggerText) {
      unlockTrack(track);
      return;
    }

    const root = prose ?? chapters;
    const viewport = window.visualViewport;
    let ranges = null;
    let pendingFrame = 0;

    function scheduleCheck() {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(checkVisibility);
    }

    const textObserver = new MutationObserver(() => {
      ranges = null;
      scheduleCheck();
    });
    const layoutObserver = new ResizeObserver(scheduleCheck);

    function checkVisibility() {
      pendingFrame = 0;
      if (document.visibilityState === "hidden") return;
      if (ranges === null) ranges = findTriggerRanges(root, triggerText);
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? document.documentElement.clientWidth);
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const visible = ranges.some(range => {
        const parent = range.startContainer.parentElement;
        if (parent.checkVisibility) {
          if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        } else if (getComputedStyle(parent).visibility !== "visible") {
          return false;
        }
        return Array.from(range.getClientRects()).some(rect =>
          rect.width > 0 && rect.height > 0 &&
          rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top,
        );
      });
      if (!visible) return;

      textObserver.disconnect();
      layoutObserver.disconnect();
      document.removeEventListener("scroll", scheduleCheck, true);
      document.removeEventListener("visibilitychange", scheduleCheck);
      window.removeEventListener("resize", scheduleCheck);
      viewport?.removeEventListener("scroll", scheduleCheck);
      viewport?.removeEventListener("resize", scheduleCheck);
      unlockTrack(track);
    }

    textObserver.observe(root, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
    layoutObserver.observe(root);
    document.addEventListener("scroll", scheduleCheck, { passive: true, capture: true });
    document.addEventListener("visibilitychange", scheduleCheck);
    window.addEventListener("resize", scheduleCheck);
    viewport?.addEventListener("scroll", scheduleCheck, { passive: true });
    viewport?.addEventListener("resize", scheduleCheck, { passive: true });
    scheduleCheck();
  }

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
      .pick-track { display: block; margin-bottom: 5px; }
      .pick-track select { max-width: min(16rem, 65vw); font: inherit; }
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
      <label class="pick-track" hidden>曲目 <select aria-label="可播放的曲目"></select></label>
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
  const picker = layer.querySelector(".pick-track");
  const trackSelect = picker.querySelector("select");

  player.hidden = true;
  document.body.append(host);

  let currentTrack = null;
  let requestNumber = 0;
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
    picker.hidden = view === "collapsed" || trackSelect.options.length < 2;
  }

  function unlockTrack(track) {
    const option = document.createElement("option");
    option.value = String(tracks.indexOf(track));
    option.textContent = track.title;
    trackSelect.append(option);
    player.hidden = false;
    picker.hidden = playerView === "collapsed" || trackSelect.options.length < 2;
    if (!currentTrack || (track.triggerText && playerView === "closed")) selectTrack(track);
  }

  function selectTrack(track) {
    if (currentTrack === track) return;
    currentTrack = track;
    trackSelect.value = String(tracks.indexOf(track));
    started = false;
    if (sound.hasAttribute("src")) {
      sound.pause();
      sound.removeAttribute("src");
      sound.load();
    }
    stopTick();
    cues = [];
    positions = [];
    title.textContent = track.title;
    start.title = track.title;
    sound.setAttribute("aria-label", track.title);
    setPlayerView("closed");
    loadLyrics();
  }

  trackSelect.addEventListener("change", () => selectTrack(tracks[Number(trackSelect.value)]));

  function resetPositions() {
    positions = randomPositions(cues, positions);
    shuffleOnPlay = false;
    clearLyric();
  }

  function loadLyrics() {
    const number = ++requestNumber;
    start.disabled = true;
    start.textContent = "正在读取歌词…";
    showStatus("");
    let settled = false;

    function failed() {
      if (settled || number !== requestNumber) return;
      settled = true;
      start.textContent = "重试读取歌词";
      start.disabled = false;
      showStatus("歌词读取失败。请检查 LRC 文件地址和脚本管理器的站点权限。");
    }

    function loaded(response) {
      if (settled || number !== requestNumber) return;
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
        url: mediaUrl(currentTrack.lyrics ?? currentTrack.file + ".lrc"),
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
    if (!sound.hasAttribute("src")) sound.src = mediaUrl(currentTrack.audio ?? currentTrack.file + ".mp3");
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
  tracks.forEach(waitForTriggerText);
})();
