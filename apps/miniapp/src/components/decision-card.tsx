import { useMemo, useReducer, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { api, type Decision, type Member } from "../lib/api";
import { currentActor, isOrganizer, setActor, type Actor } from "../lib/actor";
import { Card, CardContent } from "./ui/card";
import { formatVnd } from "../lib/utils";

/**
 * Thẻ "ĐANG CHỜ CHỐT" — màn quan trọng nhất theo wireframe.
 *
 * Đây là chỗ DUY NHẤT trong sản phẩm thể hiện Zino dung hoà ý muốn xung đột của
 * nhiều người. Nên nó phải nói đủ bốn thứ, thiếu cái nào cũng mất ý nghĩa:
 *   1. ai đã chọn gì
 *   2. ai CHƯA chọn
 *   3. Zino nghiêng phương án nào và VÌ SAO
 *   4. nút Chốt — chỉ người tổ chức
 *
 * Chốt ≠ trừ tiền. Sheet xác nhận phải nói rõ điều đó, vì đây là lúc người dùng
 * lo nhất và cũng là lúc dễ mất niềm tin nhất.
 */
export function DecisionCard({
  tripId,
  decision,
  members,
  onChanged
}: {
  /** Cần vì actor lưu THEO TỪNG CHUYẾN — xem lib/actor.ts */
  tripId: number;
  decision: Decision;
  members: Member[];
  onChanged: (d: Decision) => void;
}) {
  // Tính lại mỗi lần đổi chuyến, KHÔNG giữ trong useState.
  //
  // Thẻ này nằm cùng một vị trí trong cây React ở mọi chuyến, nên đổi chuyến
  // không làm component mount lại — hàm khởi tạo của useState sẽ không chạy lần
  // hai và actor của chuyến cũ kẹt lại. `actorTick` chỉ để ép đọc lại
  // localStorage ngay sau khi người dùng vừa chọn tên.
  const [actorTick, bumpActor] = useReducer((n: number) => n + 1, 0);
  const actor = useMemo(
    () => currentActor(tripId, members),
    [tripId, members, actorTick]
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chưa biết mình là ai thì không bầu được — hỏi trước, một lần.
  if (!actor) {
    return (
      <WhoAreYou
        members={members}
        onPick={(a) => {
          setActor(tripId, a);
          bumpActor();
        }}
      />
    );
  }

  const myVote = decision.options.find((o) => o.voterNames.includes(actor.displayName));

  async function vote(optionId: number) {
    if (!actor) return;
    setBusy(optionId);
    setError(null);
    try {
      onChanged(await api.vote(decision.id, optionId, actor));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không bình chọn được");
    } finally {
      setBusy(null);
    }
  }

  async function decide(optionId: number) {
    if (!actor) return;
    setBusy(optionId);
    setError(null);
    try {
      const r = await api.decide(decision.id, optionId, actor);
      onChanged(r.view);
      // Người bấm sau thấy trạng thái đã chốt — không phải lỗi, chỉ là chậm chân
      if (r.alreadyDecided) setError("Người khác vừa chốt trước — đây là kết quả cuối.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chốt được");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const confirmOption = decision.options.find((o) => o.id === confirm);

  return (
    <>
      <Card className="overflow-hidden border-accent/50">
        <div className="flex items-center gap-1.5 bg-accent/15 px-4 py-2">
          <AlertTriangle size={14} className="text-accent-foreground" />
          <span className="text-xs font-semibold text-accent-foreground">
            {decision.isTie ? "ĐANG HOÀ PHIẾU" : "ĐANG CHỜ CHỐT"} · {decision.title}
          </span>
        </div>

        <CardContent className="space-y-2 py-3">
          {decision.options.map((o) => {
            const mine = myVote?.id === o.id;
            return (
              <div
                key={o.id}
                className={`rounded-lg border p-2.5 ${
                  mine ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">
                      {o.label}
                      {o.price != null && (
                        <span className="ml-1.5 font-semibold">{formatVnd(o.price)}</span>
                      )}
                    </p>
                    {o.detail && <p className="text-xs text-muted-foreground">{o.detail}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {o.voterNames.length > 0 ? `${o.voterNames.join(", ")} đã chọn` : "chưa ai chọn"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void vote(o.id)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-foreground"
                    }`}
                  >
                    {busy === o.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : mine ? (
                      <span className="flex items-center gap-1">
                        <Check size={13} /> Đã chọn
                      </span>
                    ) : (
                      "Chọn"
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          {decision.pendingNames.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Còn {decision.pendingNames.join(", ")} chưa bình chọn
            </p>
          )}
          {decision.isTie && (
            <p className="text-xs text-muted-foreground">
              Đang hoà — chờ người tổ chức chốt. Zino không tự xử.
            </p>
          )}

          {/* Lý do của Zino — thứ biến app từ danh sách thành bằng chứng agent có suy nghĩ */}
          {decision.recommendationReason && (
            <p className="rounded-lg bg-muted px-2.5 py-2 text-xs leading-relaxed">
              ↳ Zino nghiêng{" "}
              <b>
                {decision.options.find((o) => o.id === decision.recommendedOptionId)?.label ??
                  "một phương án"}
              </b>
              : {decision.recommendationReason}
            </p>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          {/* Nút Chốt chỉ người tổ chức thấy. Server vẫn tự kiểm — ẩn nút không phải là quyền. */}
          {isOrganizer(actor) && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                setConfirm(
                  myVote?.id ??
                    decision.recommendedOptionId ??
                    decision.options[0]?.id ??
                    null
                )
              }
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Chốt phương án
            </button>
          )}
          {/* Chuyến do bot tạo có thể KHÔNG có ai là organizer. Lúc đó câu
              "người tổ chức là người bấm chốt" thành ngõ cụt: chờ một người
              không tồn tại. Nói thẳng ra và chỉ đường xử lý. */}
          {!isOrganizer(actor) &&
            (members.some((m) => m.role === "organizer") ? (
              <p className="text-center text-[11px] text-muted-foreground">
                {members.find((m) => m.role === "organizer")?.displayName} là người bấm chốt
              </p>
            ) : (
              <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
                Chuyến này chưa có người tổ chức nên chưa ai chốt được. Nhắn “@Zino đặt tôi làm
                người tổ chức” trong nhóm Zalo.
              </p>
            ))}
        </CardContent>
      </Card>

      {/* Sheet xác nhận — nói rõ chốt KHÔNG phải trừ tiền */}
      {confirmOption && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="w-full space-y-3 rounded-t-2xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <h2 className="text-lg font-bold">Chốt “{confirmOption.label}”?</h2>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>Sau khi chốt, Zino sẽ đi giữ chỗ.</p>
              <p>Giữ chỗ miễn phí, huỷ được trước 12h.</p>
              <p className="font-medium text-foreground">Chưa trừ tiền ở bước này.</p>
            </div>

            {decision.pendingNames.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {decision.pendingNames.join(", ")} chưa bình chọn — vẫn chốt?
              </p>
            )}

            {/* Đổi phương án ngay trong sheet, khỏi thoát ra chọn lại */}
            {decision.options.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {decision.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setConfirm(o.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      o.id === confirm
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="flex-1 rounded-lg border border-border py-3 text-sm font-medium"
              >
                Để sau
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide(confirmOption.id)}
                className="flex-1 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy !== null ? "Đang chốt…" : "Chốt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Hỏi một lần: bạn là ai trong nhóm. Xem lib/actor.ts về giới hạn của cách này. */
function WhoAreYou({ members, onPick }: { members: Member[]; onPick: (a: Actor) => void }) {
  return (
    <Card className="border-accent/50">
      <CardContent className="space-y-2.5 py-3.5">
        <div>
          <p className="text-sm font-semibold">Bạn là ai trong nhóm?</p>
          <p className="text-xs text-muted-foreground">
            Zino cần biết để ghi phiếu bình chọn đúng người. Chỉ hỏi một lần.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button
              key={m.zaloUserId}
              type="button"
              onClick={() =>
                onPick({
                  zaloUserId: m.zaloUserId,
                  displayName: m.displayName,
                  role: m.role
                })
              }
              className="rounded-full bg-muted px-3 py-2 text-sm font-medium active:bg-primary active:text-primary-foreground"
            >
              {m.displayName}
            </button>
          ))}
        </div>
        {members.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Chuyến này chưa có thành viên nào — nhắn Zino trong nhóm trước nhé.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
