# YT Live NicoNico Comment Overlay

YouTube Liveのチャットコメントを**ニコニコ動画風**（右から左へスクロール）に動画プレイヤー上に直接オーバーレイ表示する**Chrome拡張機能 (Manifest V3)** です。**ピクチャーインピクチャー (PiP)** にも対応しています。

---

## 機能

| 機能 | 詳細 |
|---|---|
| ニコニコ風コメント | Canvasオーバーレイによる右から左へのスクロール |
| スーパーチャット検出 | `yt-live-chat-paid-message-renderer`から検出；色付きのバッジと大きなフォントで描画 |
| メンバーシップメッセージ | `yt-live-chat-membership-item-renderer`；緑色で描画 |
| PiPオーバーレイ | `captureStream()`を利用し、Canvasフレームを隠しvideo要素にミラーリングしてPiP表示 |
| パフォーマンス | 同時表示コメント数の制限；レーンベースの垂直スロット割り当て；`requestAnimationFrame`ループ |
| 設定可能 | ポップアップから速度、フォントサイズ、不透明度、最大表示数をスライダーで調整可能 |

---

## プロジェクト構成

```
manifest.json
src/
  content.js      — チャット監視（iframe） + Canvasオーバーレイ（視聴ページ）
  background.js   — Service Worker；iframeから視聴ページへのメッセージを中継
  overlay.css     — オーバーレイCanvasの配置
popup/
  popup.html      — 拡張機能のポップアップUI
  popup.css       — ダークグラスモーフィズムのスタイル
  popup.js        — 設定の読み込み/保存 + ホットリロード
icons/
  icon16.png
  icon48.png
  icon128.png
scripts/
  generate_icons.js  — （任意）sharpを使用してアイコンを再生成
```

---

## インストール方法（デベロッパーモード）

1. **chrome://extensions** を開く
2. 右上のトグルから **デベロッパーモード** をオンにする
3. **パッケージ化されていない拡張機能を読み込む** をクリック
4. このフォルダ（`YT Live PIP niconico comment`）を選択する

---

## 仕組み

### チャットの抽出 (iframe)
YouTubeはライブチャットを別個の`iframe`（`/live_chat?...`）として埋め込んでいます。
コンテンツスクリプトはこのiframe内で実行され、`#items.yt-live-chat-item-list-renderer`に`MutationObserver`を設定します。
新しい`yt-live-chat-*-renderer`要素が追加されるたびに解析し、そのペイロードを`chrome.runtime.sendMessage` → `background.js` → トップフレームのコンテンツスクリプトの順で送信します。

### オーバーレイの描画 (視聴ページ)
`#movie_player`内の絶対位置に`<canvas id="yt-nicovideo-canvas">`が子要素として挿入され、100×100%のサイズで展開されます。
`requestAnimationFrame`のループにより、各コメントの`x`座標が左へ進み、視認性を高めるためのテキストシャドウ付きで描画され、左端から出たコメントは削除されます。

### 垂直レーンの割り当て
コメントは水平の「レーン（行）」に割り当てられ、重ならないように処理されます。
すべてのレーンが埋まっている場合は、ランダムなレーンに割り当てられます（ラップアラウンド）。

### PiP (ピクチャーインピクチャー) のサポート
`<video>`要素で`enterpictureinpicture`が発火した際の処理：
1. 2つ目のオフスクリーン`<canvas>`（`pipCanvas`）が作成されます。
2. 描画ティックごとにメインのCanvasの内容が`pipCanvas`にコピーされます。
3. `pipCanvas.captureStream(30)`が隠し`<video>`要素にストリームを供給します。
4. その動画が`requestPictureInPicture()`を呼び出し、コメントオーバーレイをフローティングPiPウィンドウで表示します。

> **注意:** 現在のブラウザ仕様では、PiPウィンドウは同時に1つしか開けません。そのため、オーバーレイのPiPはメイン動画のPiPを置き換える形になります。完全な同時デュアルPiPの実現はブラウザの制限により不可能です。両方を表示したい場合は、メイン動画をタブに表示したまま、オーバーレイのみPiPを使用してください。

---

## 設定 (ポップアップ)

| 設定 | 範囲 | デフォルト |
|---|---|---|
| スピード | 2 – 20 px/フレーム | 8 |
| フォントサイズ | 14 – 48 px | 26 px |
| 不透明度 | 10 – 100 % | 90 % |
| 最大コメント数 | 5 – 80 | 40 |
| スーパーチャットの表示 | オン/オフ | オン |
| メンバーシップの表示 | オン/オフ | オン |

設定は `chrome.storage.sync` に保存され、**Apply**（適用）ボタンを押すと実行中のコンテンツスクリプトに即座にホットリロードされます。

---

## 権限 (Permissions)

| 権限 | 理由 |
|---|---|
| `storage` | `chrome.storage.sync` を使用してユーザー設定を保存するため |
| `host_permissions: youtube.com` | コンテンツスクリプトを注入し、フレーム間での通信を行うため |

ネットワークリクエストは行われず、すべての処理はローカルで完結します。
