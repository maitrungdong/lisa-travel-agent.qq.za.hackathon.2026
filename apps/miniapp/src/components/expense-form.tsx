import { useState } from "react";
import { Lock, X } from "lucide-react";
import { api, type Expense, type Member } from "../lib/api";
import type { Actor } from "../lib/actor";

const CATEGORIES = [
  { key: "food", label: "Ăn uống" },
  { key: "stay", label: "Chỗ ở" },
  { key: "transport", label: "Di chuyển" },
  { key: "ticket", label: "Vé" },
  { key: "shopping", label: "Mua sắm" },
  { key: "other", label: "Khác" }
];

/**
 * Form thêm / sửa khoản chi — J4.
 *
 * Wireframe nói rõ: form PHẲNG, 6 trường, không wizard, không bắt chụp hoá đơn.
 * Người dùng đang đứng ở quán, một tay cầm điện thoại — mỗi bước thừa là một
 * lý do để họ bỏ dở và không bao giờ ghi sổ nữa.
 *
 * Quy tắc khoá hiển thị NGAY trên UI (ổ khoá + dòng giải thích) thay vì để
 * người dùng sửa xong mới báo lỗi. Luật khoá là bản sao của `expense-rules.ts`
 * bên server — server vẫn kiểm lại, đây chỉ là để không hứa hẹn cái không làm được.
 */
export function ExpenseForm({
  tripId,
  members,
  actor,
  editing,
  prefill,
  onClose,
  onSaved
}: {
  tripId: number;
  members: Member[];
  actor: Actor;
  /** null = thêm mới */
  editing: Expense | null;
  /** Dữ liệu đọc từ mã QR — chỉ dùng khi thêm mới */
  prefill?: { title?: string; amount?: number; note?: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locked = Boolean(editing && editing.source === "zino" && editing.txnCode);

  const [title, setTitle] = useState(editing?.title ?? prefill?.title ?? "");
  const [amount, setAmount] = useState(
    editing ? String(editing.amount) : prefill?.amount ? String(prefill.amount) : ""
  );
  const [category, setCategory] = useState(editing?.category ?? "food");
  const [paidBy, setPaidBy] = useState(editing?.paidBy ?? actor.zaloUserId);
  const [splitWith, setSplitWith] = useState<string[]>(members.map((m) => m.zaloUserId));
  const [note, setNote] = useState(editing?.note ?? prefill?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNumber = Number(amount.replace(/\D/g, ""));
  const valid = title.trim().length > 0 && amountNumber > 0 && splitWith.length > 0;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const r = await api.editExpense(editing.id, {
          actorZaloId: actor.zaloUserId,
          // Trường bị khoá thì KHÔNG gửi lên — gửi rồi bị từ chối chỉ tạo ra
          // thông báo lỗi khó hiểu cho việc người dùng không hề cố làm.
          ...(locked
            ? {}
            : {
                title: title.trim(),
                amount: amountNumber,
                category,
                paidBy
              }),
          splitWith,
          note: note.trim() || undefined
        });
        if (r.rejected.length > 0) {
          setError(`Không đổi được: ${r.rejected.join(", ")}`);
        }
      } else {
        await api.addExpense(tripId, {
          actorZaloId: actor.zaloUserId,
          actorName: actor.displayName,
          title: title.trim(),
          amount: amountNumber,
          category,
          paidBy,
          paidByName: members.find((m) => m.zaloUserId === paidBy)?.displayName,
          splitWith,
          note: note.trim() || undefined
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-bold">{editing ? "Sửa khoản chi" : "Thêm khoản chi"}</h2>
        <button type="button" onClick={onClose} aria-label="Đóng">
          <X size={20} />
        </button>
      </header>

      <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
        {locked && (
          <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs leading-relaxed">
            <Lock size={14} className="mt-0.5 shrink-0" />
            <span>
              Khoản này do Zino tạo và đã có giao dịch thật ({editing?.txnCode}). Số tiền và người
              trả bị khoá — chỉ đổi được cách chia và ghi chú.
            </span>
          </p>
        )}

        <Field label="Tên khoản chi" locked={locked}>
          <input
            value={title}
            disabled={locked}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Cà phê Bãi Trước"
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm disabled:opacity-60"
          />
        </Field>

        <Field label="Số tiền" locked={locked}>
          <input
            value={amount ? Number(amount.replace(/\D/g, "")).toLocaleString("vi-VN") : ""}
            disabled={locked}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="300.000"
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm disabled:opacity-60"
          />
        </Field>

        <Field label="Loại" locked={locked}>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={locked}
                onClick={() => setCategory(c.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                  category === c.key ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Ai trả" locked={locked}>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.zaloUserId}
                type="button"
                disabled={locked}
                onClick={() => setPaidBy(m.zaloUserId)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                  paidBy === m.zaloUserId ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.displayName}
              </button>
            ))}
          </div>
        </Field>

        {/* Cách chia luôn mở, kể cả với giao dịch thật — đây là thoả thuận nội
            bộ của nhóm, không phải bản ghi giao dịch. */}
        <Field label="Chia cho">
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = splitWith.includes(m.zaloUserId);
              return (
                <button
                  key={m.zaloUserId}
                  type="button"
                  onClick={() =>
                    setSplitWith((prev) =>
                      on ? prev.filter((x) => x !== m.zaloUserId) : [...prev, m.zaloUserId]
                    )
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {on ? "☑" : "☐"} {m.displayName}
                </button>
              );
            })}
          </div>
          {splitWith.length > 0 && amountNumber > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Mỗi người {Math.round(amountNumber / splitWith.length).toLocaleString("vi-VN")}đ
            </p>
          )}
        </Field>

        <Field label="Ghi chú">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="không bắt buộc"
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
          />
        </Field>

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      <div className="flex gap-2 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-border py-3 text-sm font-medium"
        >
          Huỷ
        </button>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void save()}
          className="flex-1 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Đang lưu…" : "Lưu"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  locked,
  children
}: {
  label: string;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {locked && <Lock size={11} />}
      </p>
      {children}
    </div>
  );
}
