"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { readAsDataUrl } from "@/components/logo-upload";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { errorMessage } from "@/lib/store/api";
import { useRemoveAvatarMutation, useUploadAvatarMutation } from "@/lib/store/api/people";
import { cn } from "@/lib/utils";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;

/**
 * Profile picture: drop an image on the avatar or browse for one (the logo upload's rules: PNG, JPEG or
 * WebP up to 512 KB, checked again on the server). Uploads to `/api/me/avatar`.
 */
export function AvatarUpload({
  name,
  image,
  onChanged,
}: {
  name: string;
  image: string | null;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [upload, uploading] = useUploadAvatarMutation();
  const [remove, removing] = useRemoveAvatarMutation();
  const busy = uploading.isLoading || removing.isLoading;

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPEG or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("The picture must be 512 KB or smaller");
      return;
    }
    try {
      await upload({ dataUrl: await readAsDataUrl(file) }).unwrap();
      toast.success("Profile picture updated");
      onChanged();
    } catch (e) {
      toast.error("Upload failed", { description: errorMessage(e) });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={image ? "Replace profile picture" : "Upload a profile picture"}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          "rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          over && "ring-2 ring-primary",
        )}
      >
        <UserAvatar name={name} image={image} className="size-14 text-base" />
      </button>
      <div className="grid gap-1">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImageUp /> {uploading.isLoading ? "Uploading…" : image ? "Replace" : "Upload picture"}
          </Button>
          {image && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                remove(undefined)
                  .unwrap()
                  .then(() => {
                    toast.success("Profile picture removed");
                    onChanged();
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)));
              }}
            >
              <Trash2 /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 512 KB.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="avatar-file"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
