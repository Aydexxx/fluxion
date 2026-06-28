import { useEffect, useRef, useState } from "react";
import { authApi, errorMessage } from "../lib/api";
import type { User } from "../lib/types";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/toast";
import { CameraIcon } from "./icons";

const PREVIEW = 240;
const OUTPUT = 256;

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: (user: User) => void;
}

/**
 * Pick an image, zoom to frame it inside a circular crop, preview, and save. The
 * crop is rendered to a small JPEG data URL client-side so the stored avatar
 * stays tiny (no object storage needed).
 */
export function AvatarUploadDialog({ open, onClose, onUploaded }: Props) {
  const toast = useToast();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset whenever the dialog opens (render-time pattern; no setState-in-effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setImg(null);
    setZoom(1);
    setSaving(false);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  /** Draw the image to `ctx`, scaled to cover the square at the current zoom, centered. */
  const drawTo = (canvas: HTMLCanvasElement | null, size: number) => {
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const cover = size / Math.min(img.naturalWidth, img.naturalHeight);
    const scale = cover * zoom;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  };

  // Re-render the preview whenever the image or zoom changes.
  useEffect(() => {
    drawTo(canvasRef.current, PREVIEW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        setZoom(1);
        setImg(image);
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!img || saving) return;
    const out = document.createElement("canvas");
    out.width = OUTPUT;
    out.height = OUTPUT;
    drawTo(out, OUTPUT);
    const dataUrl = out.toDataURL("image/jpeg", 0.85);
    setSaving(true);
    try {
      const user = await authApi.setAvatar(dataUrl);
      toast.success("Avatar updated");
      onUploaded(user);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not upload avatar"));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="sm">
      <DialogHeader title="Update avatar" icon={<CameraIcon />} description="Pick a picture and frame it." />
      <DialogBody>
        <div className="flex flex-col items-center gap-4">
          <div
            className="relative overflow-hidden rounded-full ring-1 ring-white/12"
            style={{ width: PREVIEW, height: PREVIEW }}
          >
            {img ? (
              <canvas ref={canvasRef} width={PREVIEW} height={PREVIEW} className="block" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-void/50 text-center text-[12.5px] text-faint">
                No image selected
              </div>
            )}
          </div>

          {img ? (
            <label className="flex w-full max-w-[240px] items-center gap-2 text-[12px] text-muted">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="flex-1 accent-[var(--color-accent)]"
              />
            </label>
          ) : null}

          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" aria-label="Choose image" />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            {img ? "Choose a different image" : "Choose image"}
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={!img}>
          Save avatar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
