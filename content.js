/**
 * content.js
 *
 * [chat iframe]  MutationObserver でコメント検出 -> background.js 経由で中継
 * [watch page]   コメントを Canvas にニコニコ風スクロール描画
 *
 * PiP方式: Document PiP API でウィンドウを開き、
 *   Canvas に drawImage(video) でフレームをミラー + コメントを重ね描き。
 *   video 要素はメインDOMに残したまま -> 閉じても黒画面にならない。
 */

(function () {
  'use strict';

  const IS_CHAT = location.href.includes('/live_chat');
  const IS_WATCH = location.href.includes('/watch');

  if (IS_CHAT) { initChatObserver(); return; }
  if (IS_WATCH) { initOverlay(); }

  let savedChatSrc = null;

  // YouTubeはSPA（単一ページアプリケーション）のため、ページ遷移を監視
  document.addEventListener('yt-navigate-finish', () => {
    savedChatSrc = null; // ページ遷移でリセット
    if (location.href.includes('/watch') && !renderer) {
      initOverlay();
    }
  });

  /* ==============================================
   * CHAT IFRAME: コメント抽出 & 送信
   * ============================================== */
  function initChatObserver() {
    waitForElement('#items.yt-live-chat-item-list-renderer', (list) => {
      const seen = new Set();
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of m.addedNodes)
            if (n.nodeType === Node.ELEMENT_NODE) parseItem(n, seen);
      }).observe(list, { childList: true });
    });
  }

  function parseItem(el, seen) {
    const tag = el.tagName.toLowerCase();
    const isSC = tag === 'yt-live-chat-paid-message-renderer';
    const isMem = tag === 'yt-live-chat-membership-item-renderer';
    const isReg = tag === 'yt-live-chat-text-message-renderer';
    if (!isSC && !isMem && !isReg) return;

    const author = (el.querySelector('#author-name') || el.querySelector('#name'))
      ?.textContent.trim() || '名無し';

    let text = '';
    const msgEl = el.querySelector('#message');
    if (msgEl) {
      for (const n of msgEl.childNodes)
        text += n.nodeType === Node.TEXT_NODE ? n.textContent
          : n.tagName === 'IMG' ? (n.alt || '')
            : n.textContent;
      text = text.trim();
    } else if (isMem) {
      text = (el.querySelector('#header-subtext, #detail-text'))
        ?.textContent.trim() || '[メンバー]';
    }

    let scAmount = '', scColor = '';
    if (isSC) {
      scAmount = el.querySelector('#purchase-amount, #purchase-amount-chip')
        ?.textContent.trim() || '';
      const hdr = el.querySelector('#header');
      if (hdr) {
        const bg = getComputedStyle(hdr).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)') scColor = bg;
      }
      // テキストがない（金額のみの）スーパーチャットも表示するため空文字を回避
      if (!text) text = scAmount ? `${scAmount} ナイスパ！` : 'ナイスパ！';
    }

    if (!text) return;

    const key = `${author}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value);

    try {
      chrome.runtime.sendMessage({
        type: 'YT_CHAT_COMMENT',
        author, text, isSuperChat: isSC, isMembership: isMem,
        superChatAmount: scAmount, superChatColor: scColor,
      }, () => {
        // エラー（受信側がいない等）を無視してコンソールを汚さない
        if (chrome.runtime.lastError) { }
      });
    } catch (e) { }
  }

  /* ==============================================
   * WATCH PAGE: オーバーレイ初期化
   * ============================================== */
  let renderer = null;
  let overlayEnabled = true;

  function initOverlay() {
    const DEFAULTS = {
      enabled: true, maxComments: 40, speed: 8,
      fontSize: 26, opacity: 0.9, showSuperChat: true, showMembership: true, showUsername: true,
      textColor: '#ffffff', isBold: true, isItalic: false, isStroke: true,
      hideNicoBtn: false, hidePipBtn: false, hidePipComment: false
    };
    chrome.storage.sync.get(DEFAULTS, (s) => {
      overlayEnabled = s.enabled;
      if (!overlayEnabled) return;
      waitForElement('#movie_player', () => {
        renderer = new CommentRenderer(s);
        renderer.mount();
        listenComments(s);
        maintainHiddenChat();
        // ポップアップ / background.js からの PiP 起動リクエストを受信
        document.addEventListener('__yt_nicovideo_pip_request', () => {
          renderer?.enableDocumentPiP();
        });
      });
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SETTINGS_UPDATE') {
        overlayEnabled = msg.settings.enabled !== false;
        renderer?.applySettings(msg.settings);
      }
    });
  }

  function listenComments(s) {
    const seen = new Set();
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type !== 'YT_CHAT_COMMENT' || !overlayEnabled || !renderer) return;

      const key = `${msg.author}:${msg.text}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 1000) seen.delete(seen.values().next().value);

      if (msg.isSuperChat && s.showSuperChat === false) return;
      if (msg.isMembership && s.showMembership === false) return;
      renderer.addComment(msg);
    });
  }

  function maintainHiddenChat() {
    setInterval(() => {
      if (!location.href.includes('/watch')) return;

      const chatFrame = document.querySelector('iframe#chatframe');
      const showHideBtn = document.querySelector('#show-hide-button');

      if (chatFrame && chatFrame.src && (chatFrame.src.includes('live_chat') || chatFrame.src.includes('live_chat_replay'))) {
        savedChatSrc = chatFrame.src;
      }

      if (!showHideBtn && !chatFrame && !savedChatSrc) return;

      const hasOriginalChat = !!chatFrame;
      let hiddenFrame = document.getElementById('yt-nicovideo-hidden-chat');

      if (!hasOriginalChat) {
        if (!hiddenFrame) {
          let url = savedChatSrc;
          if (!url) {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              if (script.textContent.includes('ytInitialData')) {
                const match = script.textContent.match(/"showLiveChatEndpoint":\{"continuation":"([^"]+)"/);
                if (match) {
                  const isReplay = script.textContent.includes('live_chat_replay');
                  const baseUrl = isReplay ? 'https://www.youtube.com/live_chat_replay' : 'https://www.youtube.com/live_chat';
                  url = `${baseUrl}?continuation=${match[1]}`;
                  break;
                }
              }
            }
          }
          if (!url) {
            const videoId = new URLSearchParams(location.search).get('v');
            if (!videoId) return;
            const isLive = document.querySelector('meta[itemprop="isLiveBroadcast"][content="True"], meta[itemprop="isLiveBroadcast"][content="true"]');
            const baseUrl = isLive ? 'https://www.youtube.com/live_chat' : 'https://www.youtube.com/live_chat_replay';
            url = `${baseUrl}?v=${videoId}`;
          }

          hiddenFrame = document.createElement('iframe');
          hiddenFrame.id = 'yt-nicovideo-hidden-chat';
          hiddenFrame.src = url;
          hiddenFrame.style.cssText = 'width:1px;height:1px;position:absolute;top:0;left:0;opacity:0;pointer-events:none;z-index:-1;';
          document.body.appendChild(hiddenFrame);
        }
      } else {
        if (hiddenFrame) hiddenFrame.remove();
      }
    }, 2000);
  }

  /* ==============================================
   * CommentRenderer
   * ============================================== */
  class CommentRenderer {
    constructor(s) {
      this.maxComments = s.maxComments ?? 40;
      this.baseSpeed = s.speed ?? 8;
      this.fontSize = s.fontSize ?? 26;
      this.opacity = s.opacity ?? 0.9;
      this.textColor = s.textColor ?? '#ffffff';
      this.isBold = s.isBold ?? true;
      this.isItalic = s.isItalic ?? false;
      this.isStroke = s.isStroke ?? true;
      this.showUsername = s.showUsername ?? true;
      this.hideNicoBtn = s.hideNicoBtn ?? false;
      this.hidePipBtn = s.hidePipBtn ?? false;
      this.hidePipComment = s.hidePipComment ?? false;

      this.comments = [];
      this.canvas = null;
      this.ctx = null;
      this.playerEl = null;
      this.overlayEl = null;
      this.raf = null;
      this.resizeObs = null;

      // PiP
      this.pipWin = null;
      this.pipCanvas = null;
      this.pipCtx = null;
      this.pipVideo = null;
      this.pipControls = null; // コントロールUI参照用
    }

    /* -- Canvasをプレイヤーの上に配置 -- */
    mount() {
      this.playerEl = document.querySelector('#movie_player');
      if (!this.playerEl) return;

      this.overlayEl = document.createElement('div');
      this.overlayEl.id = 'yt-nicovideo-overlay-wrapper';
      this.overlayEl.setAttribute('aria-hidden', 'true');

      this.canvas = document.createElement('canvas');
      this.canvas.id = 'yt-nicovideo-canvas';
      this.overlayEl.appendChild(this.canvas);

      // Canvasを直接 playerEl の末尾に追加して最前面へ
      this.playerEl.appendChild(this.overlayEl);

      this.ctx = this.canvas.getContext('2d');
      this.syncSize();

      this.resizeObs = new ResizeObserver(() => this.syncSize());
      this.resizeObs.observe(this.playerEl);

      this.injectPlayerButton();

      const tick = () => { this.render(); this.raf = requestAnimationFrame(tick); };
      this.raf = requestAnimationFrame(tick);
    }

    injectPlayerButton() {
      waitForElement('.ytp-right-controls', (controls) => {
        if (!document.getElementById('yt-nicovideo-pip-toggle')) {
          const pipBtn = document.createElement('button');
          pipBtn.id = 'yt-nicovideo-pip-toggle';
          pipBtn.className = 'ytp-button';
          pipBtn.style.verticalAlign = 'top';
          pipBtn.style.width = '40px';
          pipBtn.style.textAlign = 'center';
          pipBtn.style.display = this.hidePipBtn ? 'none' : '';
          // PiPアイコンを左上に微調整
          pipBtn.innerHTML = `<svg style="position:relative; top:-8px; left:-12px;" height="100%" version="1.1" viewBox="0 0 36 36" width="100%"><path d="M25,17 L17,17 L17,23 L25,23 L25,17 L25,17 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z" fill="#fff"></path></svg>`;
          pipBtn.title = 'PiPモード起動';
          pipBtn.onclick = () => {
            this.enableDocumentPiP();
          };
          controls.insertBefore(pipBtn, controls.firstChild);
        }

        if (document.getElementById('yt-nicovideo-player-toggle')) return;
        const btn = document.createElement('button');
        btn.id = 'yt-nicovideo-player-toggle';
        btn.className = 'ytp-button';
        btn.style.verticalAlign = 'top';
        btn.style.width = '50px';
        btn.style.textAlign = 'center';
        btn.style.display = this.hideNicoBtn ? 'none' : '';

        btn.innerHTML = `<span style="display:inline-block; line-height:36px; font-size:12px; font-weight:normal; color:#fff; position:relative; top:-7px;">NICO</span>`;
        btn.title = 'メイン画面のニコニココメント表示/非表示（クリックでテストコメント送信）';

        btn.onclick = () => {
          if (this.overlayEl) {
            const isHidden = this.overlayEl.style.display === 'none';
            this.overlayEl.style.display = isHidden ? 'block' : 'none';
            btn.style.opacity = isHidden ? '1' : '0.4';

            // ボタンを押したときに流れるようにテストコメントを追加
            if (isHidden) {
              this.addComment({
                author: 'System',
                text: 'ニコニココメント表示: ON',
                isSuperChat: false,
                isMembership: false
              });
            } else {
              // オフにしたときは何も流さないが、強制的にテストを流したい場合のために
              // （非表示になったのでCanvasには描かれない）
            }
          }
        };
        // 最初の要素の前に挿入（字幕ボタンの左あたり）
        controls.insertBefore(btn, controls.firstChild);
      });
    }

    syncSize() {
      if (!this.playerEl || !this.canvas) return;
      const r = this.playerEl.getBoundingClientRect();
      this.canvas.width = r.width || 854;
      this.canvas.height = r.height || 480;
    }

    /* -- レンダリング: 位置更新 -> メインCanvas -> PiP Canvas -- */
    render() {
      // 1. 位置更新と画面外に出たコメントの削除（filterを使ってO(N)で高速化）
      this.comments = this.comments.filter(c => {
        c.x -= c.speed;
        return c.x + c.width >= 0;
      });

      // コメントがない時は無駄なクリア処理を省くためのフラグ
      const hasComments = this.comments.length > 0;

      // 2. メインCanvas
      if (this.ctx && this.canvas) {
        if (hasComments) {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          for (const c of this.comments) this.drawComment(this.ctx, c);
          this._mainCanvasCleared = false;
        } else if (!this._mainCanvasCleared) {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this._mainCanvasCleared = true;
        }
      }

      // 3. PiP Canvas（ビデオミラー + コメント）
      if (this.pipCtx && this.pipCanvas && this.pipVideo) {
        const pc = this.pipCtx, pv = this.pipCanvas;
        pc.clearRect(0, 0, pv.width, pv.height);
        try { pc.drawImage(this.pipVideo, 0, 0, pv.width, pv.height); } catch (_) { }
        // hidePipCommentが有効なときはコメントを描画しない
        if (!this.hidePipComment) {
          for (const c of this.comments) this.drawComment(pc, c);
        }

        // コントロールのUI同期
        if (this.pipControls) {
          const c = this.pipControls;
          c.btnPlay.textContent = this.pipVideo.paused ? '▶' : '⏸';

          if (!c.isDragging) {
            const dur = this.pipVideo.duration;
            const cur = this.pipVideo.currentTime;

            if (!isNaN(dur) && isFinite(dur) && dur > 0) {
              c.seek.max = dur;
              c.seek.value = cur;
              c.durTime.textContent = this.formatTime(dur);
            } else {
              // ライブ配信などでdurationがInfinityの場合
              c.seek.max = 100;
              c.seek.value = 100;
              c.durTime.textContent = 'LIVE';
            }
            c.currTime.textContent = this.formatTime(cur);
          }
        }
      }
    }

    drawComment(ctx, c) {
      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.textBaseline = 'top';

      const weight = this.isBold ? 'bold' : 'normal';
      const style = this.isItalic ? 'italic' : 'normal';
      ctx.font = `${style} ${weight} ${c.fontSize}px "Noto Sans JP","Helvetica Neue",Arial,sans-serif`;

      if (c.isSuperChat) {
        ctx.fillStyle = c.superChatColor || '#f9a825';
      } else {
        ctx.fillStyle = c.isMembership ? '#00e676' : this.textColor;
      }

      if (this.isStroke) {
        // 黒のストローク（縁取り）
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000000';
        ctx.strokeText(c.text, c.x, c.y);
      } else {
        // ストロークOFF時は従来の影
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
      }
      
      // 文字の塗りつぶし
      ctx.fillText(c.text, c.x, c.y);
      ctx.restore();
    }

    /* -- コメント追加 -- */
    addComment(msg) {
      if (this.comments.length >= this.maxComments) {
        const idx = this.comments.findIndex(c => !c.isSuperChat);
        if (idx !== -1) this.comments.splice(idx, 1);
        else return;
      }
      if (!this.canvas || !this.ctx) return;

      const fs = msg.isSuperChat ? this.fontSize * 1.35 : this.fontSize;

      let text = '';
      const scPrefix = msg.isSuperChat && msg.superChatAmount ? `[${msg.superChatAmount}] ` : '';
      if (this.showUsername) {
        text = msg.isSuperChat ? `${scPrefix}${msg.author}: ${msg.text}` : `${msg.author}: ${msg.text}`;
      } else {
        text = msg.isSuperChat ? `${scPrefix}${msg.text}` : msg.text;
      }

      this.ctx.save();
      const weight = this.isBold ? 'bold' : 'normal';
      const style = this.isItalic ? 'italic' : 'normal';
      this.ctx.font = `${style} ${weight} ${fs}px "Noto Sans JP",Arial,sans-serif`;
      const w = this.ctx.measureText(text).width + 12;
      this.ctx.restore();

      // 文字が長い場合は最大で約+2だけ速度を速くする
      const speedBonus = Math.min(2.5, (w / this.canvas.width) * 2.5);
      const speed = this.baseSpeed + speedBonus;

      // 行（レーン）を取得してY座標を決定
      const lane = this.pickLane(fs, this.canvas.width, this.canvas.height, speed);

      this.comments.push({
        text, x: this.canvas.width + 10, y: lane.y,
        width: w, fontSize: fs, speed, lane: lane.id,
        isSuperChat: msg.isSuperChat || false,
        isMembership: msg.isMembership || false,
        superChatAmount: msg.superChatAmount || '',
        superChatColor: msg.superChatColor || '#f9a825',
      });
    }

    /**
     * 空きレーン（行）を探す。
     * 速度が違うコメントが追突しないか（画面外に出る前に追いつかないか）を計算して空きを判定。
     */
    pickLane(fontSize, canvasW, canvasH, newSpeed) {
      const lh = Math.ceil(fontSize + 6);
      const maxLane = Math.max(1, Math.floor(canvasH / lh));

      const lastInLane = new Map();
      for (const c of this.comments) {
        if (!lastInLane.has(c.lane) || c.x > lastInLane.get(c.lane).x) {
          lastInLane.set(c.lane, c);
        }
      }

      const availableLanes = [];
      for (let i = 0; i < maxLane; i++) {
        const lastC = lastInLane.get(i);

        if (!lastC) {
          availableLanes.push(i);
          continue;
        }

        // 1. まず初期ギャップがあるか（前のコメントの右端が画面内に十分入っているか）
        if (lastC.x + lastC.width + 20 >= canvasW) {
          continue;
        }

        // 2. 追突判定：新しいコメントが速い場合、前のコメントが消える前に追いつかないか？
        // 前のコメントの右端が完全に画面外(x=0)に消えるまでのフレーム数
        const framesToExit = (lastC.x + lastC.width) / lastC.speed;

        // そのフレーム数経過後の、新しいコメントの左端のX座標
        const newXAfterExit = canvasW - (newSpeed * framesToExit);

        // 新しいコメントの左端が 20px 以上の余裕を持って入ればセーフ（追突しない）
        if (newXAfterExit > 20) {
          availableLanes.push(i);
        }
      }

      let chosenLane;
      if (availableLanes.length > 0) {
        // 空いている行の中からランダムに選ぶ（まんべんなく散らすため）
        chosenLane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
      } else {
        // 全部の行が詰まっている場合はランダムな行に重ねる
        chosenLane = Math.floor(Math.random() * maxLane);
      }

      return {
        id: chosenLane,
        y: chosenLane * lh + 6
      };
    }

    formatTime(s) {
      if (isNaN(s)) return '0:00';
      const m = Math.floor(s / 60);
      const ss = Math.floor(s % 60).toString().padStart(2, '0');
      return `${m}:${ss}`;
    }

    /* ==============================================
     * Document PiP API
     *
     * ビデオ要素を移動しないためYouTubeが壊れない。
     * PiP Canvas に毎フレーム drawImage でミラーするだけ。
     *
     * サイズ: 動画解像度の 50%（アスペクト比維持）
     * 表示:  Flexbox + max-width/height:100%;width/height:auto
     *        -> ウィンドウを変形しても引き延ばされずレターボックス表示
     * ============================================== */
    async enableDocumentPiP() {
      if (this.pipWin) return;

      if (!window.documentPictureInPicture) {
        console.warn('[NicoOverlay] Document PiP API 非対応 (Chrome 116+ 必要)');
        return;
      }

      const video = document.querySelector('#movie_player video');
      if (!video) return;

      try {
        const vW = video.videoWidth || 854;
        const vH = video.videoHeight || 480;

        // 縦型・横型でウィンドウ初期サイズを切り替え
        // 縦型（portrait）: 高さ基準480px、横型: 幅基準480px
        const SHORT = 480;
        let W, H;
        if (vH > vW) {
          // 縦型動画
          H = SHORT;
          W = Math.round(SHORT * (vW / vH));
        } else {
          // 横型動画
          W = SHORT;
          H = Math.round(SHORT * (vH / vW));
        }

        const pipWin = await window.documentPictureInPicture.requestWindow({ width: W, height: H });
        this.pipWin = pipWin;
        this.pipVideo = video;

        const doc = pipWin.document;
        doc.title = 'ニコニコオーバーレイ';

        // Flexbox で Canvas を中央配置 → 引き延ばさずレターボックス
        doc.body.style.cssText = [
          'margin:0', 'padding:0', 'background:#000',
          'display:flex', 'justify-content:center', 'align-items:center',
          'width:100vw', 'height:100vh', 'overflow:hidden',
        ].join(';');

        // Canvas は動画の実際のアスペクト比に合わせる（縦型対応）
        // CSS で max-width/height 制限し aspect-ratio を自動維持
        const pipCanvas = doc.createElement('canvas');
        pipCanvas.width = vW;
        pipCanvas.height = vH;
        pipCanvas.style.cssText = [
          'display:block',
          'max-width:100%', 'max-height:100%',
          'width:auto', 'height:auto',
        ].join(';');
        doc.body.appendChild(pipCanvas);

        // CSS追加（コントロールパネル用）
        const style = doc.createElement('style');
        style.textContent = `
          .pip-controls {
            position: absolute; bottom: 0; left: 0; right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.9));
            display: flex; flex-direction: column;
            padding: 15px 20px 10px;
            opacity: 0; transition: opacity 0.3s ease;
            font-family: sans-serif;
            z-index: 999999;
          }
          body:hover .pip-controls { opacity: 1; }
          .progress-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
          .time { color: #fff; font-size: 13px; font-variant-numeric: tabular-nums; min-width: 40px; text-align: center; text-shadow: 1px 1px 2px #000; }
          input[type="range"] { 
            flex: 1; cursor: pointer; height: 4px; border-radius: 2px;
            -webkit-appearance: none; background: rgba(255,255,255,0.3);
          }
          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none; width: 12px; height: 12px;
            border-radius: 50%; background: #ff4040;
          }
          .btn-row { display: flex; justify-content: center; gap: 30px; align-items: center; }
          .pip-btn { 
            background: none; border: none; color: #fff; font-size: 24px; 
            cursor: pointer; transition: transform 0.1s, opacity 0.2s; opacity: 0.9;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            padding: 0; margin: 0;
          }
          .pip-btn:hover { transform: scale(1.15); opacity: 1; }
        `;
        (doc.head || doc.documentElement).appendChild(style);

        // コントロールDOM構築
        const controls = doc.createElement('div');
        controls.className = 'pip-controls';
        controls.innerHTML = `
          <div class="progress-row">
            <span class="time" id="currTime">0:00</span>
            <input type="range" id="seek" min="0" max="100" value="0" step="0.1">
            <span class="time" id="durTime">0:00</span>
          </div>
          <div class="btn-row">
            <button class="pip-btn" id="btnPrev" title="前の動画">⏮</button>
            <button class="pip-btn" id="btnPlay" title="再生/一時停止">⏸</button>
            <button class="pip-btn" id="btnNext" title="次の動画">⏭</button>
          </div>
        `;
        (doc.body || doc.documentElement).appendChild(controls);

        this.pipCanvas = pipCanvas;
        this.pipCtx = pipCanvas.getContext('2d');

        // コントロール参照とイベントバインディング
        this.pipControls = {
          seek: controls.querySelector('#seek'),
          btnPlay: controls.querySelector('#btnPlay'),
          btnPrev: controls.querySelector('#btnPrev'),
          btnNext: controls.querySelector('#btnNext'),
          currTime: controls.querySelector('#currTime'),
          durTime: controls.querySelector('#durTime'),
          isDragging: false
        };

        const c = this.pipControls;
        c.seek.addEventListener('input', () => {
          c.isDragging = true;
          c.currTime.textContent = this.formatTime(c.seek.value);
        });
        c.seek.addEventListener('change', () => {
          if (this.pipVideo) this.pipVideo.currentTime = c.seek.value;
          c.isDragging = false;
        });

        c.btnPlay.addEventListener('click', () => {
          if (!this.pipVideo) return;
          if (this.pipVideo.paused) this.pipVideo.play();
          else this.pipVideo.pause();
        });

        c.btnPrev.addEventListener('click', () => {
          const btn = document.querySelector('.ytp-prev-button');
          if (btn) btn.click();
        });

        c.btnNext.addEventListener('click', () => {
          const btn = document.querySelector('.ytp-next-button');
          if (btn) btn.click();
        });

        pipWin.addEventListener('pagehide', () => this.disableDocumentPiP());

      } catch (e) {
        console.error('[NicoOverlay] Document PiP error:', e);
        this.pipWin = this.pipVideo = this.pipControls = null;
      }
    }

    /* PiP終了後始末（ビデオは動かしていないので YouTube は無傷） */
    disableDocumentPiP() {
      this.pipWin = this.pipCanvas = this.pipCtx = this.pipVideo = this.pipControls = null;
    }

    applySettings(s) {
      if (s.maxComments != null) this.maxComments = s.maxComments;
      if (s.speed != null) this.baseSpeed = s.speed;
      if (s.fontSize != null) this.fontSize = s.fontSize;
      if (s.opacity != null) this.opacity = s.opacity;
      if (s.textColor != null) this.textColor = s.textColor;
      if (s.isBold != null) this.isBold = s.isBold;
      if (s.isItalic != null) this.isItalic = s.isItalic;
      if (s.isStroke != null) this.isStroke = s.isStroke;
      if (s.showUsername != null) this.showUsername = s.showUsername;
      if (s.hideNicoBtn != null) {
        this.hideNicoBtn = s.hideNicoBtn;
        const nicoBtn = document.getElementById('yt-nicovideo-player-toggle');
        if (nicoBtn) nicoBtn.style.display = s.hideNicoBtn ? 'none' : '';
        // NICOボタン非表示 ON → コメントオーバーレイも非表示にする
        if (s.hideNicoBtn && this.overlayEl) {
          this.overlayEl.style.display = 'none';
          if (nicoBtn) nicoBtn.style.opacity = '0.4';
        }
      }
      if (s.hidePipBtn != null) {
        this.hidePipBtn = s.hidePipBtn;
        const pipBtn = document.getElementById('yt-nicovideo-pip-toggle');
        if (pipBtn) pipBtn.style.display = s.hidePipBtn ? 'none' : '';
        // PIPボタン非表示 ON → PiPウィンドウを閉じる
        if (s.hidePipBtn && this.pipWin) {
          try { this.pipWin.close(); } catch (_) {}
          this.disableDocumentPiP();
        }
      }
      if (s.hidePipComment != null) this.hidePipComment = s.hidePipComment;
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.resizeObs?.disconnect();
      this.overlayEl?.remove();
      this.disableDocumentPiP();
    }
  }

  /* -- ユーティリティ -- */
  function waitForElement(sel, cb, ms = 300, limit = 30000) {
    const el = document.querySelector(sel);
    if (el) { cb(el); return; }
    const t0 = Date.now();
    const tid = setInterval(() => {
      const f = document.querySelector(sel);
      if (f) { clearInterval(tid); cb(f); }
      else if (Date.now() - t0 > limit) clearInterval(tid);
    }, ms);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

})();
