// ja translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "画面を録画",
  recTitle: "画面を録画する",
  recIntro:
    "問題が起きている様子をそのまま見せましょう。録画するのはこのブラウザータブで、表示されているものはすべて含まれます。",
  recPoint1: "レポートを送信するまで、何もアップロードされません。",
  recPoint2: "ページ上で非公開に指定されたフィールドも、録画では隠れません。",
  recLimit: "最長 {time}。録画は自動的に停止します。",
  recMic: "音声ナレーションを追加",
  recMicNote: "ブラウザーがマイクの使用許可を求めます。",
  recStart: "録画を開始",
  recCountdown: "{n} 秒後に録画を開始します",
  recHidden:
    "停止するには、ポインターを左下の隅に動かすか、Alt+Shift+S を押してください。操作ボタンは録画されません。",
  recBar: "画面録画の操作",
  recRecording: "録画中",
  recPaused: "一時停止中",
  recPause: "録画を一時停止",
  recResume: "録画を再開",
  recStop: "録画を停止",
  recTime: "{time} / {max}",
  recWindow: "録画",
  recPreviewTitle: "録画を確認",
  recPreviewLabel: "録画のプレビュー",
  recRetake: "撮り直す",
  recDiscard: "破棄",
  recAttach: "録画を添付",
  recAttached: "録画を添付しました",
  recRemove: "録画を削除",
  recRow: "画面録画 · {time}",
  recRowVoice: "音声付き画面録画 · {time}",
  recPlay: "録画を再生",
  recLimitTime: "録画が最長時間（{time}）に達したため停止しました。",
  recLimitSize: "録画がサイズの上限に達したため停止しました。",
  recMicOff: "マイクを利用できないため、この録画には音声がありません。",
  recDenied:
    "画面の録画がキャンセルまたはブロックされました。ブラウザーで許可してから、もう一度お試しください。",
  recUnsupported:
    "このブラウザーでは画面を録画できません。Chrome、Edge、Firefox、Safari のデスクトップ版をお試しください。",
  recFailed: "録画に失敗しました。もう一度お試しください。",
  recTooBig: "録画が大きすぎて添付できません。もっと短く録画してください。",
} satisfies RecordCatalog;
