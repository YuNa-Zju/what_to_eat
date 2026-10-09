import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import { FormModal } from './dialogs';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { Photo } from '@/lib/types';

export function PostPhotos({ images, restaurant }: { images: Photo[]; restaurant: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const index = selected === null ? 0 : Math.min(selected, images.length - 1);
  const move = (delta: number) =>
    setSelected((current) => Math.max(0, Math.min(images.length - 1, (current ?? 0) + delta)));
  useEffect(() => {
    if (selected === null || !images.length) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setSelected((current) =>
        Math.max(
          0,
          Math.min(images.length - 1, (current ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)),
        ),
      );
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected, images.length]);
  if (!images.length) return null;
  return (
    <>
      <button
        type="button"
        className="group relative mt-5 block w-full overflow-hidden rounded-xl bg-muted text-left"
        aria-label={`查看${restaurant}的全部 ${images.length} 张照片`}
        onClick={() => setSelected(0)}
      >
        <img
          src={images[0].url}
          alt={`${restaurant}的用餐照片`}
          loading="lazy"
          decoding="async"
          className="aspect-[16/10] max-h-80 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        {images.length > 1 && (
          <span className="absolute bottom-3 right-3 flex min-h-10 items-center gap-2 rounded-xl bg-black/60 px-3 text-sm font-medium text-white backdrop-blur-sm">
            <Images className="size-4" />+{images.length - 1}
          </span>
        )}
      </button>
      {selected !== null && (
        <FormModal
          wide
          title={`${restaurant} · 餐桌相册`}
          onClose={() => setSelected(null)}
          footer={
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="touch-button"
                  disabled={index === 0}
                  onClick={() => move(-1)}
                  aria-label="上一张照片"
                >
                  <ChevronLeft className="size-4" />
                  <span className="hidden sm:inline">上一张</span>
                </Button>
                <p
                  className="text-sm tabular-nums text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {index + 1} / {images.length}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="touch-button"
                  disabled={index === images.length - 1}
                  onClick={() => move(1)}
                  aria-label="下一张照片"
                >
                  <span className="hidden sm:inline">下一张</span>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              {images.length > 1 && (
                <div
                  className="flex gap-2 overflow-x-auto py-1 horizontal-scroll"
                  aria-label="照片缩略图"
                >
                  {images.map((image, i) => (
                    <button
                      key={image.id}
                      type="button"
                      aria-label={`显示第 ${i + 1} 张照片`}
                      aria-pressed={index === i}
                      onClick={() => setSelected(i)}
                      className={cn(
                        'size-12 shrink-0 overflow-hidden rounded-lg border-2',
                        index === i
                          ? 'border-primary ring-2 ring-primary/15'
                          : 'border-transparent opacity-60 hover:opacity-100',
                      )}
                    >
                      <img
                        src={image.url}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        >
          <div
            className="flex min-h-32 items-center justify-center rounded-xl bg-muted/50"
            style={{ touchAction: 'pan-y pinch-zoom' }}
            onTouchStart={(event) => {
              const point = event.touches[0];
              touch.current =
                event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null;
            }}
            onTouchMove={(event) => {
              if (event.touches.length > 1) touch.current = null;
            }}
            onTouchEnd={(event) => {
              const from = touch.current;
              touch.current = null;
              if (!from) return;
              const point = event.changedTouches[0];
              const dx = point.clientX - from.x;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(point.clientY - from.y) * 1.5)
                move(dx < 0 ? 1 : -1);
            }}
          >
            <img
              key={images[index].id}
              src={images[index].url}
              alt={`${restaurant}照片 ${index + 1}`}
              className="max-h-[min(55dvh,32rem)] w-full rounded-lg object-contain"
              decoding="async"
            />
          </div>
        </FormModal>
      )}
    </>
  );
}
