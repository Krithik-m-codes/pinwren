"use client";

import { ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type TFn, tEn } from "@/lib/i18n/english";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useUploadBrandAssetMutation } from "@/lib/store/api";
import { cn } from "@/lib/utils";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;

export type UploadedLogo = { id: string; url: string };

export function readAsDataUrl(file: File, t: TFn = tEn): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error ?? new Error(t("components1.couldntReadFile")));
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
  label,
  className,
}: {
  value: string | null;
  onUploaded: (logo: UploadedLogo) => void;
  label?: string;
  className?: string;
}) {
  const t = useT();
  const labelText = label ?? t("components1.uploadLogo");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [uploadAsset] = useUploadBrandAssetMutation();

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      toast.error(t("components1.logoBadType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("components1.logoTooBig"));
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file, t);
      const { asset } = await uploadAsset({ dataUrl }).unwrap();
      onUploaded(asset);
    } catch (e) {
      toast.error(t("components1.uploadFailed"), { description: errorMessage(e) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        aria-label={value ? t("components1.replaceLogo") : labelText}
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
          <img src={value} alt={t("components1.currentLogo")} className="size-full object-contain p-1" />
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
          <ImageUp /> {busy ? t("components1.uploading") : value ? t("components1.replace") : labelText}
        </Button>
        <p className="text-xs text-muted-foreground">{t("components1.logoHint")}</p>
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
