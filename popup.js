/**
 * popup.js — ポップアップコントローラー
 *
 * 役割:
 *  • chrome.storage.sync から設定を読み込んでUIに反映
 *  • スライダー操作中にリアルタイムで数値ラベルを更新
 *  • 「設定を適用」でストレージ保存 + アクティブタブへ即時反映
 */

'use strict';

const toggleEnabled    = document.getElementById('toggleEnabled');
const speedRange       = document.getElementById('speedRange');
const fontSizeRange    = document.getElementById('fontSizeRange');
const textColorInput   = document.getElementById('textColorInput');
const opacityRange     = document.getElementById('opacityRange');
const maxCommentsRange = document.getElementById('maxCommentsRange');
const toggleSuperChat  = document.getElementById('toggleSuperChat');
const toggleMembership      = document.getElementById('toggleMembership');
const toggleUsername        = document.getElementById('toggleUsername');
const toggleHideNicoBtn     = document.getElementById('toggleHideNicoBtn');
const toggleHidePipBtn      = document.getElementById('toggleHidePipBtn');
const toggleHidePipComment  = document.getElementById('toggleHidePipComment');
const settingsPanel         = document.getElementById('settingsPanel');

const speedValue       = document.getElementById('speedValue');
const fontSizeValue    = document.getElementById('fontSizeValue');
const opacityValue     = document.getElementById('opacityValue');
const maxCommentsValue = document.getElementById('maxCommentsValue');

const DEFAULTS = {
  enabled: true, speed: 8, fontSize: 26, opacity: 0.9,
  maxComments: 40, showSuperChat: true, showMembership: true, showUsername: true,
  textColor: '#ffffff', isBold: true, isItalic: false, isStroke: true,
  hideNicoBtn: false, hidePipBtn: false, hidePipComment: false
};

/* ── 起動時：保存済み設定を読み込む ── */
chrome.storage.sync.get(DEFAULTS, (s) => {
  toggleEnabled.checked    = s.enabled;
  speedRange.value         = s.speed;
  fontSizeRange.value      = s.fontSize;
  textColorInput.value     = s.textColor;
  opacityRange.value       = Math.round(s.opacity * 100);
  maxCommentsRange.value   = s.maxComments;
  toggleSuperChat.checked         = s.showSuperChat;
  toggleMembership.checked        = s.showMembership;
  toggleUsername.checked          = s.showUsername;
  toggleHideNicoBtn.checked       = s.hideNicoBtn;
  toggleHidePipBtn.checked        = s.hidePipBtn;
  toggleHidePipComment.checked    = s.hidePipComment;

  // スタイルボタンの初期状態設定
  document.getElementById('btnBold').classList.toggle('active', s.isBold);
  document.getElementById('btnItalic').classList.toggle('active', s.isItalic);
  document.getElementById('btnStroke').classList.toggle('active', s.isStroke);

  refreshLabels(s);
  setPanelState(s.enabled);
});



/* ── スライダー操作中のリアルタイム表示 ── */
speedRange.addEventListener('input',       () => { speedValue.textContent       = speedRange.value; });
fontSizeRange.addEventListener('input',    () => { fontSizeValue.textContent    = fontSizeRange.value; });
opacityRange.addEventListener('input',     () => { opacityValue.textContent     = opacityRange.value; });
maxCommentsRange.addEventListener('input', () => { maxCommentsValue.textContent = maxCommentsRange.value; });

/* ── マスタートグル ── */
toggleEnabled.addEventListener('change', () => {
  setPanelState(toggleEnabled.checked);
  autoSave();
});

/* ── スタイルボタントグル ── */
['btnBold', 'btnItalic', 'btnStroke'].forEach(id => {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    autoSave();
  });
});

/* ── 各種設定のオートセーブ ── */
const inputs = [
  speedRange, fontSizeRange, textColorInput, opacityRange, maxCommentsRange,
  toggleSuperChat, toggleMembership, toggleUsername,
  toggleHideNicoBtn, toggleHidePipBtn, toggleHidePipComment
];
inputs.forEach(input => {
  input.addEventListener('change', autoSave);
  if (input.type === 'range') {
    input.addEventListener('input', autoSave);
  }
});

async function autoSave() {
  const s = readForm();
  await chrome.storage.sync.set(s);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url?.includes('youtube.com')) {
      await chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATE', settings: s });
    }
  } catch (_) {}
}

/* ── ヘルパー関数 ── */
function readForm() {
  return {
    enabled:        toggleEnabled.checked,
    speed:          Number(speedRange.value),
    fontSize:       Number(fontSizeRange.value),
    textColor:      textColorInput.value,
    isBold:         document.getElementById('btnBold').classList.contains('active'),
    isItalic:       document.getElementById('btnItalic').classList.contains('active'),
    isStroke:       document.getElementById('btnStroke').classList.contains('active'),
    opacity:        Number(opacityRange.value) / 100,
    maxComments:    Number(maxCommentsRange.value),
    showSuperChat:   toggleSuperChat.checked,
    showMembership:  toggleMembership.checked,
    showUsername:    toggleUsername.checked,
    hideNicoBtn:     toggleHideNicoBtn.checked,
    hidePipBtn:      toggleHidePipBtn.checked,
    hidePipComment:  toggleHidePipComment.checked,
  };
}

function refreshLabels(s) {
  speedValue.textContent       = s.speed;
  fontSizeValue.textContent    = s.fontSize;
  opacityValue.textContent     = Math.round(s.opacity * 100);
  maxCommentsValue.textContent = s.maxComments;
}

function setPanelState(enabled) {
  settingsPanel.classList.toggle('disabled', !enabled);
}
