import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { openPartnerChat } from "../lib/zalo";

/**
 * CONCIERGE HANDOFF — màn ăn điểm nhất của demo.
 *
 * Bối cảnh kỹ thuật (quan trọng, đừng sửa mất ý nghĩa):
 *   Zalo KHÔNG có API cho server gửi tin tới OA khác. Mọi thư viện làm được
 *   điều đó đều giả lập tài khoản cá nhân → vi phạm ToS.
 *
 *   Đường hợp lệ duy nhất là `openChat({type:"oa", id, message})` của zmp-sdk:
 *   nó mở đúng cửa sổ chat với OA và ĐIỀN SẴN nội dung. Tài liệu Zalo ghi rõ
 *   "việc gửi tin nhắn hay không phụ thuộc vào quyết định của người dùng."
 *
 *   Nên: Zino soạn hộ câu hỏi đầy đủ → user đọc lại, sửa nếu muốn → bấm Gửi.
 *   Human-in-the-loop đúng nghĩa, và đó là điểm cộng khi pitch, không phải hạn chế.
 */
export default function HandoffPage() {
  const [params] = useSearchParams();
  const oaId = params.get("oa") ?? "";
  const initialMessage = params.get("msg") ?? "";
  const oaName = params.get("name") ?? "đối tác";

  const [message, setMessage] = useState(initialMessage);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "opening" | "opened" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  useEffect(() => setMessage(initialMessage), [initialMessage]);

  const charCount = useMemo(() => Array.from(message).length, [message]);

  async function handleOpen() {
    if (!oaId) return;
    setStatus("opening");
    const result = await openPartnerChat(oaId, message);
    if (result.ok) {
      setStatus("opened");
    } else {
      setStatus("error");
      setErrorText(result.error);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setStatus("opened");
    } catch {
      setErrorText("Không copy được, bạn bôi đen và copy thủ công nhé");
      setStatus("error");
    }
  }

  if (!oaId) {
    return (
      <div className="py-16 text-center text-slate-500">
        <p>Thiếu thông tin đối tác.</p>
        <p className="mt-1 text-sm">Hãy mở màn này từ gợi ý của Zino trong chat nhé.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-sky-600">
          Zino soạn hộ bạn
        </p>
        <h1 className="text-xl font-bold text-slate-900">Nhắn cho {oaName}</h1>
        <p className="text-sm text-slate-500">
          Mình đã viết sẵn câu hỏi đầy đủ. Bạn đọc lại, sửa nếu muốn, rồi bấm gửi —
          <span className="font-medium text-slate-700"> mình không tự gửi thay bạn.</span>
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Nội dung tin nhắn</span>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-xs font-medium text-sky-600"
          >
            {editing ? "Xong" : "Sửa"}
          </button>
        </div>

        {editing ? (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={10}
            maxLength={1500}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 outline-none focus:border-sky-400"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{message}</p>
        )}

        <p className="mt-2 text-right text-xs text-slate-400">{charCount}/1500</p>
      </section>

      {status === "opened" && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          ✅ Đã mở chat với {oaName}. Bấm Gửi trong cửa sổ chat để hoàn tất nhé!
        </div>
      )}
      {status === "error" && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p>⚠️ {errorText}</p>
          <p>
            Bạn có thể mở trang OA rồi dán tin:{" "}
            <a
              href={`https://zalo.me/${oaId}`}
              className="font-medium underline"
              target="_blank"
              rel="noreferrer"
            >
              zalo.me/{oaId}
            </a>
          </p>
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={handleOpen}
          disabled={status === "opening" || !message.trim()}
          className="w-full rounded-xl bg-sky-600 py-3.5 text-base font-semibold text-white shadow-sm active:bg-sky-700 disabled:opacity-50"
        >
          {status === "opening" ? "Đang mở chat…" : `Mở chat với ${oaName}`}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="w-full rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-600"
        >
          Copy tin nhắn
        </button>
      </div>

      <p className="pb-4 text-center text-xs leading-relaxed text-slate-400">
        Zino không gửi tin thay bạn. Quyền quyết định gửi hay không luôn thuộc về bạn.
      </p>
    </div>
  );
}
