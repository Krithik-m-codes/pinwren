// zh translation of en-fields.ts (custom questions, widget-fields.js); keep keys and {placeholders} identical.
import type { FieldsCatalog } from "../i18n";

export default {
  cfHeading: "更多详情",
  cfChoose: "请选择…",
  cfRequired: "此项为必填",
  cfTooShort: "最小长度：{n}",
  cfTooLong: "最大长度：{n}",
  cfBadEmail: "请输入有效的电子邮件地址",
  cfBadUrl: "请输入以 http:// 或 https:// 开头的链接",
  cfBadNumber: "请输入数字",
  cfNotInteger: "请输入整数",
  cfMin: "最小值：{n}",
  cfMax: "最大值：{n}",
  cfBadDate: "请输入有效的日期",
  cfTooFew: "至少选择：{n}",
  cfTooMany: "最多选择：{n}",
  cfFix: "请检查标出的答案",
} satisfies FieldsCatalog;
