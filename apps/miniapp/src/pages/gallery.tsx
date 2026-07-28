import { useEffect, useState } from "react";
import { Images, NotebookPen } from "lucide-react";
import { api, resolveActiveTrip, type Note, type Photo } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";

/**
 * Kỷ niệm — ảnh và nhật ký Zino gom được trong chuyến đi.
 * Ảnh do Zino tải về từ Zalo rồi nginx serve lại tại {PUBLIC_BASE_URL}/media/...
 * (photo_url gốc của Zalo là URL tạm, không dùng lại được).
 */
export default function GalleryPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<Photo | null>(null);

  useEffect(() => {
    resolveActiveTrip()
      .then((id) =>
        id ? Promise.all([api.photos(id), api.notes(id)]) : ([[], []] as [Photo[], Note[]])
      )
      .then(([p, n]) => {
        setPhotos(p);
        setNotes(n);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Kỷ niệm</h1>

      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Đang tải…</p>}

      {!loading && photos.length === 0 && notes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Images size={32} />
            <p className="text-sm">
              Gửi ảnh vào nhóm Zalo, Zino sẽ tự gom về đây kèm chú thích.
            </p>
          </CardContent>
        </Card>
      )}

      {photos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{photos.length} ảnh</h2>
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setZoom(p)}
                className="overflow-hidden rounded-xl bg-muted text-left"
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
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <NotebookPen size={14} /> Nhật ký
          </h2>
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

      {/* Xem ảnh phóng to — bấm nền để đóng */}
      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
        >
          <img src={zoom.url} alt={zoom.caption ?? ""} className="max-h-[75vh] w-auto rounded-lg" />
          {zoom.caption && <p className="text-center text-sm text-white/90">{zoom.caption}</p>}
        </button>
      )}
    </div>
  );
}
