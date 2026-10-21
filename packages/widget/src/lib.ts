// What the core shares with its lazy chunks (see chunks.ts). index.ts puts this object on
// `window.__annotaLib`; build.mjs rewrites a chunk's imports of these modules to read from it, so state such
// as the active locale and the diagnostics buffers exists once. A chunk importing a name missing here fails
// the build — add it here rather than letting the chunk bundle a second copy.
export { loadChunk, preload } from "./chunks";
export { DEFAULT_CONFIG, readableOn } from "./config";
export { diagnosticsSummary, performanceTiming, snapshotDiagnostics } from "./diagnostics";
export { adoptStyle, focused, guard, h, ICONS, icon, trapFocus } from "./dom";
export { environment, errText, uuid } from "./env";
export { consentBlock, identityFields } from "./form";
export { addEnglish, locale, t, tn } from "./i18n";
export { idbKV } from "./idb";
export { Picker } from "./picker";
export { isRetryable } from "./queue";
export { store } from "./store";
export { ago, avatar, colorFor, isClosed, kindOf, shortName, tag } from "./ui";
