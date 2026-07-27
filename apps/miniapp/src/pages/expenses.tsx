import { useEffect, useState } from "react";
import { ArrowRight, Receipt } from "lucide-react";
import { api, resolveActiveTrip, type FullTrip } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { formatVnd } from "../lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  food: "Ăn uống",
  stay: "Chỗ ở",
  transport: "Di chuyển",
  ticket: "Vé",
  shopping: "Mua sắm",
  other: "Khác"
};

/**
 * Chi phí + chia tiền.
 *
 * Kết quả chia tiền lấy TỪ SERVER (`/trips/:id/settle`), dùng chung hàm
 * settleExpenses với tool của agent. Không tính lại ở client — nếu Lisa nói
 * trong chat khác với màn hình này thì mất sạch uy tín, mà đó là lỗi rất dễ
 * mắc nếu có hai bản tính toán song song.
 */
export default function ExpensesPage() {
  const [data, setData] = useState<FullTrip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resolveActiveTrip()
      .then((id) => (id ? api.full(id) : null))
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>;
  }

  if (!data || data.expenses.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Chi phí chuyến đi</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Receipt size={32} />
            <p className="text-sm">
              Chụp hoá đơn gửi vào nhóm Zalo — Lisa đọc và ghi vào đây tự động.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { expenses, settlement, members } = data;
  const perPerson = members.length ? Math.round(settlement.totalSpent / members.length) : 0;

  const byCategory = expenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Chi phí chuyến đi</h1>

      <Card className="bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle className="text-sm font-medium opacity-80">Tổng chi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold">{formatVnd(settlement.totalSpent)}</p>
          {members.length > 0 && (
            <p className="text-sm opacity-80">
              ≈ {formatVnd(perPerson)}/người · {members.length} người
            </p>
          )}
        </CardContent>
      </Card>

      {Object.keys(byCategory).length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amt]) => (
              <span key={cat} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                {CATEGORY_LABEL[cat] ?? cat}: {formatVnd(amt)}
              </span>
            ))}
        </div>
      )}

      {/* Ai nợ ai — số giao dịch tối thiểu */}
      {settlement.settlements.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Chia tiền · {settlement.settlements.length} giao dịch là xong
          </h2>
          {settlement.settlements.map((s, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-2 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.fromName}</span>
                <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.toName}</span>
                <span className="shrink-0 font-semibold text-sky-600">{formatVnd(s.amount)}</span>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {settlement.settlements.length === 0 && members.length > 0 && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">
            🎉 Cả nhóm đã hoà nhau, không ai nợ ai.
          </CardContent>
        </Card>
      )}

      {/* Số dư từng người */}
      {settlement.perMember.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Số dư từng người</h2>
          <Card>
            <CardContent className="divide-y divide-border py-0">
              {settlement.perMember.map((m) => (
                <div key={m.zaloUserId} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      đã trả {formatVnd(m.paid)} · phải chịu {formatVnd(m.owed)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold ${
                      m.net > 0 ? "text-emerald-600" : m.net < 0 ? "text-rose-600" : "text-muted-foreground"
                    }`}
                  >
                    {m.net > 0 ? "+" : m.net < 0 ? "−" : ""}
                    {formatVnd(Math.abs(m.net))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Danh sách khoản chi */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {expenses.length} khoản chi
        </h2>
        {expenses.map((e) => (
          <Card key={e.id}>
            <CardContent className="flex items-center gap-3 py-3">
              {e.receiptPhotoUrl && (
                <img
                  src={e.receiptPhotoUrl}
                  alt="hoá đơn"
                  loading="lazy"
                  className="size-11 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {e.paidByName ?? "?"} trả · {CATEGORY_LABEL[e.category] ?? e.category}
                </p>
              </div>
              <p className="shrink-0 font-semibold">{formatVnd(e.amount)}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {settlement.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          {settlement.warnings.map((w, i) => (
            <p key={i}>⚠️ {w}</p>
          ))}
        </div>
      )}

      <div className="pb-4" />
    </div>
  );
}
