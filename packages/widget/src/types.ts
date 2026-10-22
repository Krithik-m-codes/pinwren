// Public types of the widget API (blueprint 05 §8), defined in loader.ts (the npm entry) so its generated
// .d.ts is a single self-contained file. Type-only: nothing of loader.ts ends up in widget.js.
export type {
  EventMap,
  Handler,
  IdentifyOptions,
  Mode,
  PageScope,
  PinwrenApi,
  PinwrenOptions,
  PinwrenUser,
  WidgetEvent,
} from "./loader";
