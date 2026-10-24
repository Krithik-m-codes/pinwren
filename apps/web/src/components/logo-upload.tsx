"use client";

import { ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage, useUploadBrandAssetMutation } from "@/lib/store/api";
import { cn } from "@/lib/utils";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;

export type UploadedLogo = { id: string; url: string };

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the file"));
    r.readAsDataURL(file);
  });
}

/**
 * Logo picker: drop an image on the tile or browse for one. PNG, JPEG or WebP up to 512 KB (SVG is
 * refused server-side — it can carry script). Uploads to `/api/branding/assets`.
 */
export function LogoUpload({
  value,
  onUploaded,
  label = "Upload logo",
  className,
}: {
  value: string | null;
  onUploaded: (logo: UploadedLogo) => void;
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [uploadAsset] = useUploadBrandAssetMutation();

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPEG or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("The logo must be 512 KB or smaller");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { asset } = await uploadAsset({ dataUrl }).unwrap();
      onUploaded(asset);
    } catch (e) {
      toast.error("Upload failed", { description: errorMessage(e) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        aria-label={value ? "Replace logo" : label}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={cn(
          "grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed bg-muted/40 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          over && "border-primary bg-primary/5",
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo (any host, any size); nothing for next/image to optimise
          <img src={value} alt="Current logo" className="size-full object-contain p-1" />
        ) : (
          <ImageUp className="size-5 text-muted-foreground" />
        )}
      </button>
      <div className="grid gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImageUp /> {busy ? "Uploading…" : value ? "Replace" : label}
        </Button>
        <p className="text-xs text-muted-foreground">
          PNG, JPEG or WebP, up to 512 KB. Or drop it on the tile.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="logo-file"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
    </div>
  );
}
