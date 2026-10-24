"use client";

import { useState } from "react";
import { DemoWidget } from "@/components/demo/demo-widget";
import { resetLocal } from "./local-api";
import { PlaygroundPanel } from "./playground-panel";
import { loadSettings, type PlaygroundSettings, saveSettings } from "./settings";

/** The playground's state: the options panel and the widget they drive. */
export default function PlaygroundClient() {
  const [settings, setSettings] = useState<PlaygroundSettings>(loadSettings);
  const [resetting, setResetting] = useState(false);

  const change = (patch: Partial<PlaygroundSettings>) => {
    const next = { ...settings, ...patch };
    saveSettings(next);
    setSettings(next);
  };

  // Throw the feedback away (the server sandbox or the browser copy) and start the widget again.
  const reset = async () => {
    setResetting(true);
    try {
      if (settings.mode === "local") await resetLocal();
      else await fetch("/demo-api/reset", { method: "POST" });
    } catch {
      // Nothing to undo: the widget restarts either way and shows what is there.
    } finally {
      setResetting(false);
      setSettings({ ...settings });
    }
  };

  return (
    <>
      <DemoWidget settings={settings} />
      <PlaygroundPanel
        settings={settings}
        onChange={change}
        onReset={() => void reset()}
        resetting={resetting}
      />
    </>
  );
}
