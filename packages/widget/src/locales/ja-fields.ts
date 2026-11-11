// ja translation of en-fields.ts (custom questions, widget-fields.js); keep keys and {placeholders} identical.
import type { FieldsCatalog } from "../i18n";

export default {
  cfHeading: "詳細情報",
  cfChoose: "選択してください…",
  cfRequired: "この項目は必須です",
  cfTooShort: "最小文字数: {n}",
  cfTooLong: "最大文字数: {n}",
  cfBadEmail: "有効なメールアドレスを入力してください",
  cfBadUrl: "http:// または https:// で始まるリンクを入力してください",
  cfBadNumber: "数値を入力してください",
  cfNotInteger: "整数を入力してください",
  cfMin: "最小値: {n}",
  cfMax: "最大値: {n}",
  cfBadDate: "有効な日付を入力してください",
  cfTooFew: "最低選択数: {n}",
  cfTooMany: "最大選択数: {n}",
  cfFix: "強調表示された回答を確認してください",
} satisfies FieldsCatalog;
