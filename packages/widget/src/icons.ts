// Icons only the lazy chunks use (bug report, side panel, thread card). Each is its own export so a chunk bundles just
// the ones it imports, and none of them weigh on widget.js.
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const rect = svg('<rect x="3" y="5" width="18" height="14" rx="2"/>');
export const arrow = svg('<path d="M5 19 19 5M9 5h10v10"/>');
export const pen = svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
export const blur = svg(
  '<path d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z"/>',
);
export const undo = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');
export const search = svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>');
export const ellipse = svg('<ellipse cx="12" cy="12" rx="9" ry="7"/>');
export const text = svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>');
export const crop = svg('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>');
export const redo = svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>');
export const clip = svg(
  '<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-7.9"/>',
);
export const file = svg(
  '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
);
export const view = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>');
export const page = svg('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>');
export const target = svg(
  '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
);
export const screen = svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>');
export const alert = svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>');
export const terminal = svg('<path d="m5 8 4 4-4 4M12 16h7"/>');
export const wifi = svg(
  '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0"/>',
);
export const globe = svg(
  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
);
export const minus = svg('<path d="M6 12h12"/>');
export const download = svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>');
export const close = svg('<path d="M18 6 6 18M6 6l12 12"/>');
export const check = svg('<path d="M20 6 9 17l-5-5"/>');
export const reopen = svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>');
export const link = svg(
  '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
);
export const send = svg('<path d="M12 19V5M5 12l7-7 7 7"/>');
export const external = svg(
  '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
);
export const ticket = svg(
  '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M13 6v2M13 11v2M13 16v2"/>',
);
export const bot = svg(
  '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/>',
);
