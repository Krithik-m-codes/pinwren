import { useSyncExternalStore } from "react";

// Opt-in desktop notifications (wave-5 contract §3.2), per device: the choice lives in localStorage and the
// browser's own permission. Shown only while the dashboard tab is in the background — in front, the bell
// already shows it. Every storage access is guarded: private windows and blocked storage throw.

export const DESKTOP_KEY = "pinwren:desktop-notifications";

export const desktopSupported = () => typeof window !== "undefined" && "Notification" in window;

/** On for this device: switched on here, and the browser still allows it. */
export function desktopEnabled(): boolean {
  if (!desktopSupported()) return false;
  try {
    return localStorage.getItem(DESKTOP_KEY) === "1" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * Switch it on (asking the browser for permission) or off. Resolves to the resulting state; `denied`
 * means the browser blocks it and only its site settings can change that.
 */
export async function setDesktopEnabled(on: boolean): Promise<"on" | "off" | "denied" | "unsupported"> {
  if (!desktopSupported()) return "unsupported";
  if (on) {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") {
      for (const l of listeners) l();
      return "denied";
    }
  }
  try {
    if (on) localStorage.setItem(DESKTOP_KEY, "1");
    else localStorage.removeItem(DESKTOP_KEY);
  } catch {
    // storage blocked: the switch can't be remembered on this device
    return "off";
  } finally {
    for (const l of listeners) l();
  }
  return on ? "on" : "off";
}

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export type DesktopState = "unsupported" | "blocked" | "on" | "off";

function desktopState(): DesktopState {
  if (!desktopSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return desktopEnabled() ? "on" : "off";
}

/** The switch's state on this device ("unsupported" during server rendering). */
export const useDesktopNotifications = (): DesktopState =>
  useSyncExternalStore(subscribe, desktopState, () => "unsupported");

/** Show one notification when the tab is hidden and the person opted in; clicking it focuses the tab. */
export function showDesktopNotification(n: { id: string; title: string; body: string; href: string }): void {
  if (!desktopEnabled() || typeof document === "undefined" || !document.hidden) return;
  try {
    const shown = new Notification(n.title, { body: n.body, tag: n.id });
    shown.onclick = () => {
      window.focus();
      window.location.assign(n.href);
      shown.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the bell still has it.
  }
}
