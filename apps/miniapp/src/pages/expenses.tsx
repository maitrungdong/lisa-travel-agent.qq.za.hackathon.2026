import { ArrowRight, Receipt } from "lucide-react";
import { useRecap } from "../lib/use-trip";
import { TripHeader } from "../components/trip-header";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState, ErrorState, SectionTitle, SkeletonList } from "../components/states";
import { formatVnd } from "../lib/utils";

const CATEGORY_ICON: Record<string, string> = {
  food: "🍜",
  stay: "🏨",
  transport: "🚌",
  ticket: "🎟️",
  shopping: "🛍️",
  other: "✨"
};

/**
 * Chi phí + chia tiền.
 *
 * Mọi con số ở màn này lấy TỪ SERVER (`/trips/:id/recap`), dùng chung hàm
 * settleExpenses với tool của agent. Client không tính lại — nếu Zino nói
 * trong chat một số mà màn hình hiện số khác thì mất sạch uy tín, mà đó là
 * lỗi rất dễ mắc khi có hai bản tính toán song song.
 */
export default function ExpensesPage() {
  const { data, loading, error, isEmpty, reload } = useRecap();

  if (loading) return <SkeletonList rows={4} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (isEmpty || !data) {
    return (
      <EmptyState
        icon={<Receipt size={32} />}
        title="Chưa có chuyến đi nào"
        hint="Tạo chuyến đi với Zino trong nhóm Zalo trước đã nhé."
      />
    );
  }

  const { trip, stats, byCategory, expenses, settlement } = data;

  if (expenses.length === 0) {
    return (
      <div className="space-y-4">
        <TripHeader trip={trip} />
        <EmptyState
          icon={<Receipt size={32} />}
          title="Chưa ghi khoản chi nào"
          hint="Chụp hoá đơn gửi vào nhóm Zalo — Zino đọc số tiền và ghi vào đây tự động."
        />
      </div>
    );
  }

  const spentRatio =
    stats.budgetTotal && stats.budgetTotal > 0
      ? Math.min(100, Math.round((stats.totalSpent / stats.budgetTotal) * 100))
      : null;
  const overBudget = stats.budgetRemaining != null && stats.budgetRemaining < 0;

  return (
    <div className="space-y-4">
      <TripHeader trip={trip} />

      {/* Tổng chi + ngân sách */}
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="space-y-2.5 py-4">
          <div>
            <p className="text-xs opacity-80">Tổng chi</p>
            <p className="text-2xl font-bold">{formatVnd(stats.totalSpent)}</p>
            {stats.memberCount > 0 && (
              <p className="text-sm opacity-80">
                ≈ {formatVnd(stats.perPerson)}/người · {stats.memberCount} người
              </p>
            )}
          </div>

          {spentRatio !== null && stats.budgetTotal && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-white/25">
                <div
                  className={`h-full rounded-full ${overBudget ? "bg-rose-300" : "bg-white"}`}
                  style={{ width: `${spentRatio}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs opacity-90">
                {overBudget
                  ? `Vượt ngân sách ${formatVnd(Math.abs(stats.budgetRemaining ?? 0))}`
                  : `Còn ${formatVnd(stats.budgetRemaining ?? 0)} trong ngân sách ${formatVnd(
                      stats.budgetTotal
                    )}`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cơ cấu chi tiêu — thanh tỉ trọng dễ đọc hơn dãy chip cũ */}
      {byCategory.length > 1 && (
        <section className="space-y-2">
          <SectionTitle>Tiêu vào đâu</SectionTitle>
          <Card>
            <CardContent className="space-y-2.5 py-3.5">
              {byCategory.map((c) => (
                <div key={c.category}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>
                      {CATEGORY_ICON[c.category] ?? "✨"} {c.label}
                    </span>
                    <span className="font-medium">
                      {formatVnd(c.amount)}
                      <span className="ml-1.5 text-xs text-muted-foreground">{c.share}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${c.share}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Ai chuyển cho ai — số giao dịch tối thiểu */}
      {settlement.settlements.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Chia tiền · {settlement.settlements.length} giao dịch là xong</SectionTitle>
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

      {settlement.settlements.length === 0 && stats.memberCount > 0 && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">
            🎉 Cả nhóm đã hoà nhau, không ai nợ ai.
          </CardContent>
        </Card>
      )}

      {/* Số dư từng người */}
      {settlement.perMember.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Số dư từng người</SectionTitle>
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
                      m.net > 0
                        ? "text-emerald-600"
                        : m.net < 0
                          ? "text-rose-600"
                          : "text-muted-foreground"
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

      {/* Danh sách khoản chi — mới nhất lên trên */}
      <section className="space-y-2">
        <SectionTitle>{expenses.length} khoản chi</SectionTitle>
        {[...expenses].reverse().map((e) => (
          <Card key={e.id}>
            <CardContent className="flex items-center gap-3 py-3">
              {e.receiptPhotoUrl ? (
                <img
                  src={e.receiptPhotoUrl}
                  alt="hoá đơn"
                  loading="lazy"
                  className="size-11 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
                  {CATEGORY_ICON[e.category] ?? "✨"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {e.paidByName ?? "?"} trả ·{" "}
                  {new Date(e.spentAt).toLocaleDateString("vi-VN", {
                    day: "2-digit",
                    month: "2-digit"
                  })}
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
