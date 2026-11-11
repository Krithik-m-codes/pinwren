// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingPlayer, type RecordingPlayerProps } from "./recording-player";

const base: RecordingPlayerProps = {
  src: "/api/assets/a1",
  name: "recording-2026-11-10-10-00-00.webm",
  bytes: 4_200_000,
  durationMs: 42_000,
  audio: true,
  width: 1280,
  height: 720,
};

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

describe("RecordingPlayer", () => {
  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    HTMLMediaElement.prototype.play = play;
    HTMLMediaElement.prototype.pause = pause;
  });
  afterEach(cleanup);

  const video = () => {
    const v = screen.getByTestId("recording-player").querySelector("video");
    if (!v) throw new Error("no video element");
    return v;
  };

  it("plays the file from the session-authenticated URL, without the browser's own controls", () => {
    render(<RecordingPlayer {...base} />);
    expect(video().getAttribute("src")).toBe("/api/assets/a1");
    expect(video().hasAttribute("controls")).toBe(false);
    expect(video().getAttribute("aria-label")).toBe(`Screen recording: ${base.name}`);
    expect(video().getAttribute("preload")).toBe("metadata");
  });

  it("shows the length and size, and says when there is a voice", () => {
    render(<RecordingPlayer {...base} />);
    expect(screen.getByText(/0:42 · 4\.0 MB · with voice/)).toBeTruthy();
    cleanup();
    render(<RecordingPlayer {...base} audio={false} />);
    expect(screen.getByText(/0:42 · 4\.0 MB/).textContent).not.toContain("voice");
  });

  it("offers a download of the original file", () => {
    render(<RecordingPlayer {...base} />);
    const link = screen.getByRole("link", { name: `Download recording: ${base.name}` });
    expect(link.getAttribute("href")).toBe("/api/assets/a1");
    expect(link.getAttribute("download")).toBe(base.name);
  });

  it("has labelled, keyboard-reachable controls and a seek slider", () => {
    render(<RecordingPlayer {...base} />);
    for (const name of ["Play", "Full screen", /Playback speed 1×/, "Mute"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    // The focusable thumb is the range input; its label and its spoken value are the time.
    const thumb = screen.getByTestId("recording-player").querySelector("input[type=range]");
    expect(thumb?.getAttribute("aria-label")).toBe("Seek");
    expect(thumb?.getAttribute("aria-valuetext")).toBe("0:00 of 0:42");
  });

  it("starts playback from the button and labels it from the video's own state", () => {
    render(<RecordingPlayer {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.play(video());
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.pause(video());
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    fireEvent.play(video());
    fireEvent.ended(video());
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("cycles the playback speed", () => {
    render(<RecordingPlayer {...base} />);
    const speed = () => screen.getByRole("button", { name: /Playback speed/ });
    fireEvent.click(speed());
    expect(speed().getAttribute("aria-label")).toBe("Playback speed 1.5×");
    expect(video().playbackRate).toBe(1.5);
    fireEvent.click(speed());
    expect(video().playbackRate).toBe(2);
  });

  it("has no mute button for a recording without a voice", () => {
    render(<RecordingPlayer {...base} audio={false} />);
    expect(screen.queryByRole("button", { name: /mute/i })).toBeNull();
  });

  it("starts from the measured length while the file's own duration is unknown", () => {
    render(<RecordingPlayer {...base} />);
    expect(screen.getByTestId("recording-player").textContent).toContain("0:00 / 0:42");
    Object.defineProperty(video(), "duration", { value: Number.POSITIVE_INFINITY, configurable: true });
    fireEvent.loadedMetadata(video());
    expect(screen.getByTestId("recording-player").textContent).toContain("0:00 / 0:42");
    Object.defineProperty(video(), "duration", { value: 40, configurable: true });
    fireEvent.durationChange(video());
    expect(screen.getByTestId("recording-player").textContent).toContain("0:00 / 0:40");
  });

  it("explains a file the browser can't play and keeps the download", () => {
    render(<RecordingPlayer {...base} />);
    fireEvent.error(video());
    expect(screen.getByRole("alert").textContent).toContain("couldn't be played");
    expect(screen.getByRole("button", { name: "Play" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: /Download recording/ })).toBeTruthy();
  });
});
