import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquareQuote } from "lucide-react";
import { api, resolveActiveTrip, type FullTrip, type Partner } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

const CATEGORIES = [
  { key: "", label: "Tất cả" },
  { key: "HOTEL", label: "Chỗ ở" },
  { key: "FNB", label: "Ăn uống" },
  { key: "TOUR", label: "Tour" },
  { key: "TRANSPORT", label: "Di chuyển" }
] as const;

/**
 * Danh bạ OA đối tác.
 *
 * ⚠ Zalo KHÔNG có API tìm kiếm Official Account — không endpoint nào tra OA
 * theo tên/ngành/địa điểm. Nên directory này do team tự dựng và tự seed.
 * Đây là cách hợp lệ duy nhất để làm discovery.
 */
export default function PartnersPage() {
  const navigate = useNavigate();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [trip, setTrip] = useState<FullTrip | null>(null);
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(true);
  /** true = không có đối tác ở điểm đến, đang hiện toàn mạng lưới */
  const [fellBack, setFellBack] = useState(false);

  useEffect(() => {
    resolveActiveTrip()
      .then((id) => (id ? api.full(id) : null))
      .then(setTrip)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const city = trip?.trip.destination;
    const cat = category || undefined;

    // Lọc theo điểm đến trước. Không có gì thì LÙI VỀ toàn mạng lưới —
    // thà gợi ý chỗ khác còn hơn để user nhìn màn trống và tưởng app hỏng.
    api
      .partners({ city, category: cat })
      .then(async (rows) => {
        if (rows.length > 0 || !city) return { rows, fellBack: false };
        const all = await api.partners({ category: cat });
        return { rows: all, fellBack: all.length > 0 };
      })
      .then(({ rows, fellBack }) => {
        if (cancelled) return;
        setPartners(rows);
        setFellBack(fellBack);
      })
      .catch(() => {
        if (!cancelled) setPartners([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Chuyến đi tải xong sẽ chạy lại effect này — huỷ lượt cũ để tránh
    // kết quả về muộn ghi đè kết quả mới (đúng cái gây "nháy 1 phát rồi mất")
    return () => {
      cancelled = true;
    };
  }, [trip, category]);

  /**
   * Soạn sẵn câu hỏi từ ngữ cảnh chuyến đi.
   * Trong luồng chính Lisa soạn (hay hơn, có ngữ cảnh hội thoại); đây là bản
   * dự phòng để màn này dùng được độc lập, không phụ thuộc chat.
   */
  const draft = useMemo(() => {
    return (p: Partner): string => {
      if (!trip) return `Chào ${p.name}! Mình muốn hỏi thêm thông tin và bảng giá ạ.`;

      const { destination, startDate, endDate, budgetPerPerson } = trip.trip;
      const d1 = new Date(startDate).toLocaleDateString("vi-VN");
      const d2 = new Date(endDate).toLocaleDateString("vi-VN");
      const people = trip.members.length || 2;
      const budget = budgetPerPerson
        ? `\nNgân sách nhóm mình khoảng ${budgetPerPerson.toLocaleString("vi-VN")}đ/người.`
        : "";

      const asks: Record<string, string[]> = {
        HOTEL: ["Giá và loại phòng còn trống", "Có bao gồm ăn sáng không", "Chính sách hủy phòng"],
        FNB: ["Có nhận đặt bàn cho nhóm không", "Menu và khoảng giá", "Giờ mở cửa"],
        TOUR: ["Lịch trình và giá tour", "Có đón tận nơi không", "Cần đặt trước bao lâu"],
        TRANSPORT: ["Giá thuê và loại xe", "Có giao nhận tận nơi không", "Cần giấy tờ gì"],
        ACTIVITY: ["Giá vé và khung giờ", "Có ưu đãi cho nhóm không", "Cần đặt trước không"]
      };
      const questions = (asks[p.category] ?? asks.HOTEL)
        .map((q, i) => `${i + 1}. ${q}`)
        .join("\n");

      return `Chào ${p.name}!
Nhóm mình ${people} người, dự định đi ${destination} từ ${d1} đến ${d2}.${budget}

Cho mình hỏi:
${questions}

Cảm ơn shop nhiều ạ!`;
    };
  }, [trip]);

  function handoff(p: Partner) {
    const q = new URLSearchParams({ oa: p.oaId, name: p.name, msg: draft(p) });
    navigate(`/handoff?${q.toString()}`);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold">Đối tác</h1>
        <p className="text-sm text-muted-foreground">
          {fellBack
            ? `Chưa có đối tác ở ${trip?.trip.destination} — đây là toàn mạng lưới`
            : trip
              ? `Gợi ý cho ${trip.trip.destination}`
              : "Mạng lưới OA du lịch của Lisa"}
        </p>
      </header>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
              category === c.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Đang tải…</p>}

      {!loading && partners.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Chưa có đối tác nào ở khu vực này.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {partners.map((p) => (
          <Card key={p.id}>
            <CardContent className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.city}</p>
                </div>
                {p.priceHint && (
                  <Badge variant="secondary" className="shrink-0">
                    {p.priceHint}
                  </Badge>
                )}
              </div>

              {p.description && (
                <p className="text-sm text-muted-foreground">{p.description}</p>
              )}

              {p.tags && (
                <div className="flex flex-wrap gap-1">
                  {p.tags.split(",").map((t) => (
                    <span
                      key={t}
                      className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t.trim()}
                    </span>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => handoff(p)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white active:bg-sky-700"
              >
                <MessageSquareQuote size={16} />
                Nhờ Lisa soạn tin hỏi
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="pb-4 text-center text-xs leading-relaxed text-muted-foreground">
        Lisa soạn hộ câu hỏi và mở đúng cửa sổ chat.
        <br />
        Quyền bấm Gửi luôn thuộc về bạn.
      </p>
    </div>
  );
}
