import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Images, NotebookPen, X } from "lucide-react";
import { useRecap } from "../lib/use-trip";
import { TripHeader } from "../components/trip-header";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState, ErrorState, SectionTitle, SkeletonList } from "../components/states";

/**
 * Kỷ niệm — ảnh và nhật ký Zino gom được trong chuyến đi.
 *
 * Ảnh do Zino tải về từ Zalo rồi nginx serve lại tại {PUBLIC_BASE_URL}/media/...
 * (photo_url gốc của Zalo là URL tạm, hết hạn là ảnh vỡ hết).
 */
export default function GalleryPage() {
  const { data, loading, error, isEmpty, reload } = useRecap();
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);

  const photos = data?.photos ?? [];
  const total = photos.length;

  const step = useCallback(
    (delta: number) => {
      setZoomIndex((i) => (i === null || total === 0 ? i : (i + delta + total) % total));
    },
    [total]
  );

  // Điều hướng bằng phím khi demo trên desktop; trên điện thoại thì bấm mũi tên.
  useEffect(() => {
    if (zoomIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomIndex(null);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIndex, step]);

  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (isEmpty || !data) {
    return (
      <EmptyState
        icon={<Images size={32} />}
        title="Chưa có chuyến đi nào"
        hint="Kỷ niệm sẽ hiện ở đây sau khi nhóm có chuyến đi đầu tiên."
      />
    );
  }

  const { trip, notes } = data;
  const zoom = zoomIndex === null ? null : photos[zoomIndex];

  return (
    <div className="space-y-4">
      <TripHeader trip={trip} />

      {photos.length === 0 && notes.length === 0 && (
        <EmptyState
          icon={<Images size={32} />}
          title="Chưa có kỷ niệm nào"
          hint="Gửi ảnh vào nhóm Zalo, Zino sẽ tự gom về đây kèm chú thích."
        />
      )}

      {photos.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>{photos.length} ảnh</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setZoomIndex(i)}
                className="overflow-hidden rounded-xl bg-muted text-left active:opacity-80"
              >
                <img
                  src={p.url}
                  alt={p.caption ?? "Ảnh chuyến đi"}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                {p.caption && (
                  <p className="line-clamp-2 p-2 text-xs text-muted-foreground">{p.caption}</p>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <NotebookPen size={14} /> Nhật ký
            </span>
          </SectionTitle>
          {notes.map((n) => (
            <Card key={n.id}>
              <CardContent className="space-y-1 py-3">
                <p className="text-sm leading-relaxed">{n.content}</p>
                <p className="text-xs text-muted-foreground">
                  {n.authorName ?? "Zino"} · {new Date(n.takenAt).toLocaleDateString("vi-VN")}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* Xem ảnh phóng to — lướt qua lại được, khỏi thoát ra vào từng tấm */}
      {zoom && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between p-3 text-white/80">
            <span className="text-sm">
              {(zoomIndex ?? 0) + 1}/{total}
            </span>
            <button type="button" onClick={() => setZoomIndex(null)} aria-label="Đóng">
              <X size={22} />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center gap-2 px-2">
            {total > 1 && (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Ảnh trước"
                className="shrink-0 rounded-full bg-white/10 p-2 text-white active:bg-white/20"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <img
              src={zoom.url}
              alt={zoom.caption ?? ""}
              className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
            />
            {total > 1 && (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Ảnh sau"
                className="shrink-0 rounded-full bg-white/10 p-2 text-white active:bg-white/20"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center">
            {zoom.caption && <p className="text-sm text-white/90">{zoom.caption}</p>}
            {zoom.uploaderName && (
              <p className="mt-1 text-xs text-white/50">{zoom.uploaderName} gửi</p>
            )}
          </div>
        </div>
      )}

      <div className="pb-2" />
    </div>
  );
}
