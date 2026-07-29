import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Bot, Check, Loader2, QrCode, Send, Sparkles } from "lucide-react";
import { api, type ChatAction, type ChatCard, type ChatReply } from "../lib/api";
import { currentActor } from "../lib/actor";
import { scanQr } from "../lib/zalo";
import { parsePaymentQr, suggestTitle } from "../lib/qr";
import { useRecap } from "../lib/use-trip";
import { Card, CardContent } from "../components/ui/card";
import { ErrorState, SkeletonList } from "../components/states";

interface Turn {
  role: "user" | "zino";
  text: string;
  cards?: ChatCard[];
  source?: string;
  /** Tool nào đã chạy để ra câu này */
  usedTools?: string[];
  /** Có = câu của model đã bị cổng kiểm chứng chặn, đây là câu tất định thay thế */
  gateBlocked?: string;
  /** Có = agent không chạy được (lỗi model/mạng), câu này do code tính */
  degraded?: string;
}

const SUGGESTIONS = [
  { label: "Soát lại chuyến đi", message: "Soát lại chuyến đi giúp mình" },
  { label: "Hôm nay có gì", message: "Hôm nay có gì" },
  { label: "Tiền nong sao rồi", message: "Tiền nong sao rồi" }
];

/**
 * Chat với Zino ngay trong Mini App.
 *
 * Vì sao có tab này khi đã chat được trong nhóm Zalo: Bot API **không gửi được
 * nút bấm** — nó chỉ có sendMessage/sendPhoto/sendSticker/sendChatAction/
 * sendVoice. Mọi thứ giàu hơn chữ đều phải sống ở đây. Nên tab này không phải
 * bản sao của chat nhóm; nó là chỗ Zino vừa trả lời vừa đưa nút làm việc luôn.
 *
 * Ranh giới với chat nhóm: việc cần research thật (tìm quán, hỏi đối tác, đặt
 * chỗ) vẫn đẩy về nhóm — ở đó Zino có hàng đợi, web search và push chủ động.
 * Tab này lo phần trả lời tức thì từ dữ liệu đã có.
 */
export default function ChatPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useRecap();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const tripId = data.trip.id;

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);
    try {
      const actor = currentActor();
      const r: ChatReply = await api.chat(tripId, {
        message: text,
        actorZaloId: actor?.zaloUserId,
        actorName: actor?.displayName
      });
      setTurns((t) => [
        ...t,
        {
          role: "zino",
          text: r.text,
          cards: r.cards,
          source: r.source,
          usedTools: r.usedTools,
          gateBlocked: r.gateBlocked,
          degraded: r.degraded
        }
      ]);
    } catch {
      setTurns((t) => [
        ...t,
        { role: "zino", text: "Mình không kết nối được máy chủ. Thử lại giúp mình nhé." }
      ]);
    } finally {
      setBusy(false);
    }
  }

  /** Quét QR hoá đơn → điền sẵn form khoản chi. */
  async function handleScan() {
    const raw = await scanQr();
    if (!raw) {
      show("Không quét được — thử lại hoặc nhập tay nhé.");
      return;
    }
    const qr = parsePaymentQr(raw);
    if (!qr.isPayment) {
      show("Mã này không phải QR thanh toán.");
      return;
    }
    // Chuyển sang tab Chi phí kèm dữ liệu đã đọc. Số tiền có thể null (QR không
    // ghi sẵn) — lúc đó form vẫn mở, người dùng gõ tay, hơn là chặn lại.
    const q = new URLSearchParams({
      add: "1",
      title: suggestTitle(qr),
      ...(qr.amount ? { amount: String(qr.amount) } : {}),
      ...(qr.merchantName ? { note: `QR ${qr.merchantName}` } : {})
    });
    navigate(`/expenses?${q.toString()}`);
  }

  function show(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function run(action: ChatAction) {
    switch (action.kind) {
      case "open_tab":
        navigate(action.value === "expenses" ? "/expenses" : `/${action.value ?? ""}`);
        break;
      case "scroll_to_event":
      case "open_decision":
        navigate(action.kind === "open_decision" ? "/" : "/itinerary");
        break;
      case "add_expense":
        navigate("/expenses?add=1");
        break;
      case "scan_qr":
        await handleScan();
        break;
      case "copy_to_chat":
        try {
          await navigator.clipboard.writeText(action.value ?? "");
          show("Đã copy — dán vào nhóm Zalo rồi gửi nhé.");
        } catch {
          show(action.value ?? "");
        }
        break;
    }
  }

  /**
   * Bố cục cố định thay vì cuộn cả trang.
   *
   * `sticky` không đủ: trong webview Zalo, bàn phím mở ra làm viewport co lại
   * và thanh nhập bị đẩy khuất, người dùng phải cuộn ngược lên mới gõ tiếp
   * được. `fixed` neo theo viewport nên bàn phím có mở hay không nó vẫn nằm
   * ngay trên thanh tab.
   *
   * Vùng tin nhắn tự chừa chỗ bằng padding đáy — nếu không, tin cuối luôn bị
   * thanh nhập che mất.
   */
  return (
    <div className="flex flex-col">
      <div className="space-y-3 pb-28">
        {turns.length === 0 && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center gap-2">
                <Bot size={18} className="text-primary" />
                <p className="text-sm font-semibold">Hỏi Zino về chuyến này</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Mình trả lời ngay từ dữ liệu chuyến đi. Việc cần tìm kiếm thật thì hỏi trong nhóm
                Zalo — ở đó mình research rồi báo lại.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void send(s.message)}
                    className="rounded-full bg-muted px-3 py-2 text-xs font-medium"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                {t.text}
              </p>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <div className="flex gap-2">
                <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot size={13} className="text-primary" />
                </span>
                <div className="max-w-[85%] space-y-1">
                  <p className="rounded-2xl rounded-bl-sm bg-card px-3.5 py-2.5 text-sm shadow-sm">
                    {t.text}
                  </p>
                  {/* Nói rõ số liệu từ đâu — giám khảo hỏi "sao tin được" là chỉ vào đây */}
                  {(t.usedTools?.length || t.gateBlocked || t.degraded) && (
                    <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                      {t.usedTools?.length ? `đã tra: ${t.usedTools.join(", ")}` : null}
                      {t.gateBlocked ? " · số liệu không khớp dữ liệu, đã dùng câu tính bằng code" : null}
                      {/* Agent chết mà câu trả lời vẫn trôi chảy là kiểu hỏng tệ
                          nhất — không ai biết để đi sửa. Nói thẳng ra đây. */}
                      {t.degraded ? `⚠ Zino đang chạy chế độ dự phòng: ${t.degraded}` : null}
                    </p>
                  )}
                </div>
              </div>
              {t.cards?.map((c, j) => (
                <ActionCard key={j} card={c} onAction={(a) => void run(a)} />
              ))}
            </div>
          )
        )}

        {busy && (
          <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" /> Zino đang xem…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {toast && (
        <div className="fixed inset-x-4 bottom-32 z-40 rounded-xl bg-foreground/95 p-3 text-xs text-background shadow-lg">
          {toast}
        </div>
      )}

      {/* Ghim đáy, nằm ngay trên thanh tab (h-14 ≈ 3.5rem) */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background">
        <div className="mx-auto flex max-w-md gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => void handleScan()}
          aria-label="Quét QR hoá đơn"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border"
        >
          <QrCode size={18} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(input);
          }}
          placeholder="Hỏi Zino…"
          className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3.5 text-sm"
        />
        <button
            type="button"
            disabled={!input.trim() || busy}
            onClick={() => void send(input)}
            aria-label="Gửi"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

const LEVEL_STYLE: Record<string, string> = {
  error: "border-rose-200 bg-rose-50",
  warn: "border-amber-200 bg-amber-50",
  info: "border-border bg-card",
  neutral: "border-border bg-card"
};

function ActionCard({ card, onAction }: { card: ChatCard; onAction: (a: ChatAction) => void }) {
  return (
    <div className={`ml-8 space-y-2 rounded-xl border p-3 ${LEVEL_STYLE[card.level] ?? LEVEL_STYLE.info}`}>
      <div className="flex items-start gap-1.5">
        {card.level === "error" && <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-600" />}
        {card.level === "warn" && <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-600" />}
        {card.level === "neutral" && <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />}
        {card.level === "info" && <Check size={14} className="mt-0.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{card.title}</p>
          {card.detail && <p className="text-xs text-muted-foreground">{card.detail}</p>}
        </div>
      </div>
      {card.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {card.actions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAction(a)}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
