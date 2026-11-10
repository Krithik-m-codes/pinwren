"use client";

import { Download, Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatBytes } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { aspectOf, clock, playableDuration } from "@/lib/recording";
import { cn } from "@/lib/utils";

const RATES = [1, 1.5, 2, 0.5] as const;

export type RecordingPlayerProps = {
  /** Where the file is served from (session-authenticated, byte ranges supported). */
  src: string;
  name: string;
  bytes: number;
  /** The length the widget measured: a browser-made WebM has no duration in its header. */
  durationMs: number;
  /** The reporter's voice is on the recording. */
  audio: boolean;
  width: number | null;
  height: number | null;
};

/**
 * A screen recording with controls of the design system: play / pause, a seek slider with the time as its
 * accessible value, speed, mute (only when there is a voice), full screen and a download link. The video
 * element itself has no native controls, so every control is a labelled button reachable by keyboard.
 */
export function RecordingPlayer(p: RecordingPlayerProps) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(p.durationMs / 1000);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [failed, setFailed] = useState(false);
  const total = Math.max(length, at);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };
  const seek = (to: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = to;
    setAt(to);
  };
  const nextRate = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    setRate(r);
    if (video.current) video.current.playbackRate = r;
  };

  return (
    <figure className="m-0 space-y-2" data-testid="recording-player">
      <div ref={frame} className="overflow-hidden rounded-lg border bg-black">
        {failed ? (
          <div
            role="alert"
            className="grid place-items-center gap-1 p-8 text-center text-sm text-muted-foreground"
            style={{ aspectRatio: aspectOf(p) }}
          >
            {t("recording.failed")}
          </div>
        ) : (
          // The captions track is absent on purpose: a screen recording has no transcript to offer.
          // eslint-disable-next-line jsx-a11y/media-has-caption -- reporter's own recording, no caption source
          <video
            ref={video}
            src={p.src}
            preload="metadata"
            playsInline
            aria-label={t("recording.playerLabel", { name: p.name })}
            className="block max-h-[60vh] w-full bg-black"
            style={{ aspectRatio: aspectOf(p) }}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setFailed(true)}
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setLength(playableDuration(e.currentTarget.duration, p.durationMs))}
            onDurationChange={(e) => setLength(playableDuration(e.currentTarget.duration, p.durationMs))}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={failed}
          aria-label={playing ? t("recording.pause") : t("recording.play")}
          onClick={toggle}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums" aria-hidden="true">
          {clock(at)} / {clock(total)}
        </span>
        <Slider
          aria-label={t("recording.seek")}
          min={0}
          max={Math.max(1, Math.round(total * 10))}
          step={1}
          disabled={failed || total <= 0}
          value={[Math.min(Math.round(at * 10), Math.max(1, Math.round(total * 10)))]}
          getThumbAriaValueText={() => t("recording.position", { time: clock(at), total: clock(total) })}
          onValueChange={(v) => seek((Array.isArray(v) ? (v[0] ?? 0) : v) / 10)}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={failed}
          aria-label={t("recording.speed", { rate })}
          title={t("recording.speed", { rate })}
          className="w-12 tabular-nums"
          onClick={nextRate}
        >
          {rate}×
        </Button>
        {p.audio && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={failed}
            aria-label={muted ? t("recording.unmute") : t("recording.mute")}
            aria-pressed={muted}
            onClick={() => {
              if (video.current) video.current.muted = !video.current.muted;
            }}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={failed}
          aria-label={t("recording.fullscreen")}
          title={t("recording.fullscreen")}
          onClick={() => {
            const el = frame.current;
            if (el && typeof el.requestFullscreen === "function")
              void el.requestFullscreen().catch(() => undefined);
          }}
        >
          <Maximize2 />
        </Button>
        <a
          href={p.src}
          download={p.name}
          aria-label={`${t("recording.download")}: ${p.name}`}
          title={t("recording.download")}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        >
          <Download />
        </a>
      </div>
      <figcaption className="text-xs text-muted-foreground tabular-nums">
        {t("recording.details", { duration: clock(p.durationMs / 1000), size: formatBytes(p.bytes) })}
        {p.audio ? ` · ${t("recording.withVoice")}` : ""}
      </figcaption>
    </figure>
  );
}
