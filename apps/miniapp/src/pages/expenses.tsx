import { useEffect, useMemo, useReducer, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Lock, Plus, QrCode, Receipt } from "lucide-react";
import { api, type Expense } from "../lib/api";
import { currentActor, setActor } from "../lib/actor";
import { parsePaymentQr, suggestTitle } from "../lib/qr";
import { scanQr } from "../lib/zalo";
import { ExpenseForm } from "../components/expense-form";
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
  // Tính lại theo chuyến đang mở thay vì giữ trong state — xem lib/actor.ts.
  // Màn này không mount lại khi đổi chuyến nên state sẽ giữ actor của chuyến cũ.
  const [actorTick, bumpActor] = useReducer((n: number) => n + 1, 0);
  const actor = useMemo(
    () => (data ? currentActor(data.trip.id, data.members) : null),
    [data, actorTick]
  );
  const [form, setForm] = useState<{ open: boolean; editing: Expense | null }>({
    open: false,
    editing: null
  });
  const [paid, setPaid] = useState<Set<string> | null>(null);
  const [busyPair, setBusyPair] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [prefill, setPrefill] = useState<{ title?: string; amount?: number; note?: string } | null>(
    null
  );
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  /**
   * Mở form từ nơi khác: tab Hỏi Zino điều hướng sang đây kèm `?add=1` và dữ
   * liệu đã đọc từ mã QR. Xoá query ngay sau khi dùng — không thì bấm back rồi
   * vào lại là form tự bật lên lần nữa.
   */
  useEffect(() => {
    if (params.get("add") !== "1") return;
    const amount = Number(params.get("amount") ?? "");
    setPrefill({
      title: params.get("title") ?? undefined,
      amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
      note: params.get("note") ?? undefined
    });
    setForm({ open: true, editing: null });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const tripId = data?.trip.id;
  // Tick "đã trả" nằm ở bảng riêng, không suy ra được từ settlement — phải tải rời.
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    api
      .paidPairs(tripId)
      .then((r) => {
        if (!cancelled) setPaid(new Set(r.pairs.map((x) => `${x.from}>${x.to}`)));
      })
      .catch(() => {
        if (!cancelled) setPaid(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

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
          {settlement.settlements.map((s, i) => {
            const key = `${s.from}>${s.to}`;
            const done = paid?.has(key) ?? false;
            return (
              <Card key={i} className={done ? "opacity-60" : undefined}>
                <CardContent className="flex items-center gap-2 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.fromName}</span>
                  <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.toName}</span>
                  <span
                    className={`shrink-0 font-semibold ${done ? "text-muted-foreground line-through" : "text-sky-600"}`}
                  >
                    {formatVnd(s.amount)}
                  </span>
                  {/* Tick được nếu là người trả, người nhận, hoặc người tổ chức —
                      ba người đều biết sự thật về việc chuyển tiền đó. */}
                  <button
                    type="button"
                    disabled={!actor || busyPair === key}
                    onClick={() => void togglePaid(s.from, s.to, s.amount, !done)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                  >
                    {busyPair === key ? "…" : done ? "☑ đã trả" : "☐ đã trả"}
                  </button>
                </CardContent>
              </Card>
            );
          })}
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
        <SectionTitle
          action={
            actor ? (
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void scanAndAdd()}
                  className="flex items-center gap-1 text-xs font-semibold text-primary"
                >
                  <QrCode size={13} /> Quét QR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPrefill(null);
                    setForm({ open: true, editing: null });
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-primary"
                >
                  <Plus size={13} /> Thêm
                </button>
              </span>
            ) : undefined
          }
        >
          {expenses.length} khoản chi
        </SectionTitle>
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
              <div className="shrink-0 text-right">
                <p className="font-semibold">{formatVnd(e.amount)}</p>
                {/* Khoá hiện ngay trên dòng: nhìn là biết cái nào sửa được */}
                {e.source === "zino" && e.txnCode ? (
                  <span className="flex items-center justify-end gap-0.5 text-[11px] text-muted-foreground">
                    <Lock size={10} /> {e.txnCode}
                  </span>
                ) : actor ? (
                  <button
                    type="button"
                    onClick={() => setForm({ open: true, editing: e })}
                    className="text-[11px] font-medium text-primary"
                  >
                    Sửa
                  </button>
                ) : null}
              </div>
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

      {!actor && (
        <Card>
          <CardContent className="space-y-2 py-3.5">
            <p className="text-sm font-semibold">Bạn là ai trong nhóm?</p>
            <p className="text-xs text-muted-foreground">
              Cần biết để ghi đúng ai trả tiền. Chỉ hỏi một lần.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.members.map((m) => (
                <button
                  key={m.zaloUserId}
                  type="button"
                  onClick={() => {
                    setActor(data.trip.id, {
                      zaloUserId: m.zaloUserId,
                      displayName: m.displayName,
                      role: m.role
                    });
                    bumpActor();
                  }}
                  className="rounded-full bg-muted px-3 py-2 text-sm font-medium"
                >
                  {m.displayName}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {scanMsg && (
        <div className="fixed inset-x-4 bottom-24 z-40 rounded-xl bg-foreground/95 p-3 text-xs text-background shadow-lg">
          {scanMsg}
        </div>
      )}

      {form.open && actor && (
        <ExpenseForm
          tripId={trip.id}
          members={data.members}
          actor={actor}
          editing={form.editing}
          prefill={prefill}
          onClose={() => {
            setForm({ open: false, editing: null });
            setPrefill(null);
          }}
          onSaved={reload}
        />
      )}

      <div className="pb-4" />
    </div>
  );

  /** Quét QR hoá đơn rồi mở form đã điền sẵn. */
  async function scanAndAdd() {
    const raw = await scanQr();
    if (!raw) {
      flash("Không quét được — nhập tay cũng nhanh mà.");
      return;
    }
    const qr = parsePaymentQr(raw);
    if (!qr.isPayment) {
      flash("Mã này không phải QR thanh toán.");
      return;
    }
    setPrefill({
      title: suggestTitle(qr),
      amount: qr.amount ?? undefined,
      note: qr.merchantName ? `QR ${qr.merchantName}` : undefined
    });
    setForm({ open: true, editing: null });
    // QR không ghi sẵn số tiền là chuyện thường — nói ra để người dùng khỏi
    // tưởng app đọc thiếu.
    if (qr.amount == null) flash("QR không ghi số tiền — bạn nhập giúp mình nhé.");
  }

  function flash(msg: string) {
    setScanMsg(msg);
    setTimeout(() => setScanMsg(null), 2800);
  }

  async function togglePaid(from: string, to: string, amount: number, next: boolean) {
    if (!actor || !tripId) return;
    const key = `${from}>${to}`;
    setBusyPair(key);
    try {
      await api.tickPaid(tripId, {
        actorZaloId: actor.zaloUserId,
        fromUserId: from,
        toUserId: to,
        amount,
        paid: next
      });
      setPaid((prev) => {
        const s2 = new Set(prev ?? []);
        if (next) s2.add(key);
        else s2.delete(key);
        return s2;
      });
    } catch {
      /* giữ nguyên trạng thái cũ — người dùng bấm lại được */
    } finally {
      setBusyPair(null);
    }
  }
}
