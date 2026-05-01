/**
 * background.js — サービスワーカー
 *
 * popup が action に設定されたため onClicked は不要。
 * チャットiframe → watchページ へのコメント中継のみ担当する。
 */

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'YT_CHAT_COMMENT') {
    // 同じタブのトップフレーム（watchページ）へ転送
    try {
      chrome.tabs.sendMessage(
        sender.tab.id,
        message,
        { frameId: 0 },
        () => {
          if (chrome.runtime.lastError) {}
        }
      );
    } catch(e) {}
  }
  return false;
});
