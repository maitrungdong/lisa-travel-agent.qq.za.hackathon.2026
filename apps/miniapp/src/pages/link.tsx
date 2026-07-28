import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import {
  ensureSession,
  isDeviceMode,
  lastSessionError,
  session,
  type LinkCodeResponse
} from "../lib/session";
import { Card, CardContent } from "../components/ui/card";

/**
 * Màn liên kết tài khoản Zalo với thành viên trong nhóm.
 *
 * Vì sao phải có bước này: Zalo Bot API và Zalo Mini App nhìn cùng một con
 * người dưới hai id khác namespace, và Zalo không có API nối. Mã 6 số là cây
 * cầu — nhưng cầu này chỉ đi được một chiều an toàn: user gõ mã TRONG NHÓM,
 * webhook đọc `from.id` do Zalo khẳng định. Danh tính không đến từ lời khai.
 *
 * Làm một lần cho mỗi người, sau đó không bao giờ thấy màn này nữa.
 */
export default function LinkPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<LinkCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // Phân biệt rõ hai kiểu hỏng: không có phiên (thường vì đang chạy ngoài
    // Zalo) và có phiên nhưng server từ chối. Gộp làm một thì người đọc lỗi
    // không biết phải sửa ở đâu.
    const token = await ensureSession(true);
    if (!token) {
      const e = lastSessionError();
      setError(
        e
          ? `Chưa lấy được phiên (${e.stage}): ${e.detail}`
          : "Chưa lấy được phiên đăng nhập Zalo."
      );
      return;
    }

    const r = await session.linkCode();
    if (!r) {
      setError("Có phiên nhưng server từ chối cấp mã. Kiểm tra /api/auth/status trên server.");
      return;
    }
    setState(r);
    if (r.alreadyLinked) navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Đếm ngược hạn mã — mã sống 5 phút, hết thì lấy mã mới
  useEffect(() => {
    if (!state?.expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(state.expiresAt!).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [state?.expiresAt]);

  // Hỏi server 3s/lần xem đã liên kết chưa — user gõ mã trong nhóm, app tự nhận ra.
  // Không dùng websocket: hai phút chờ trong đời một user không đáng để thêm hạ tầng.
  useEffect(() => {
    if (!state?.code) return;
    pollRef.current = window.setInterval(async () => {
      const me = await session.me();
      if (me?.linked) {
        if (pollRef.current) clearInterval(pollRef.current);
        navigate("/", { replace: true });
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state?.code, navigate]);

  async function copy() {
    if (!state?.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* không copy được thì thôi, mã vẫn hiện to trên màn hình */
    }
  }

  const expired = secondsLeft !== null && secondsLeft <= 0;

  return (
    <div className="space-y-4">
      <header className="rounded-lg bg-primary p-5 text-primary-foreground">
        <Link2 size={22} />
        <h1 className="mt-2 text-xl font-bold">Liên kết với nhóm của bạn</h1>
        <p className="mt-1 text-sm opacity-90">
          Zino cần biết bạn là ai trong nhóm để hiện đúng chuyến đi và số tiền của bạn.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="space-y-3 py-4 text-sm">
            <p className="break-words text-muted-foreground">{error}</p>
            <p className="text-xs text-muted-foreground">
              Mã lỗi Zalo tra tại docs.zaloplatforms.com → Mini App → API → Errors.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <RefreshCw size={14} /> Thử lại
            </button>
          </CardContent>
        </Card>
      )}

      {/* Nói rõ khi đang chạy ở chế độ thiết bị — team cần biết mình đang đứng ở đâu */}
      {state?.code && isDeviceMode() && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          Đang dùng phiên theo <b>thiết bị</b> vì Zalo App chưa được kích hoạt
          (<code>code -1401</code>). Liên kết vẫn chạy đúng, nhưng danh tính gắn với máy này chứ
          không gắn với tài khoản Zalo. Kích hoạt app ở developers.zalo.me là tự động chuyển.
        </div>
      )}

      {state?.code && (
        <>
          <Card>
            <CardContent className="space-y-3 py-5 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mã của bạn
              </p>
              <p className="font-mono text-4xl font-bold tracking-[0.2em] text-primary">
                {state.code}
              </p>
              {secondsLeft !== null && (
                <p className="text-xs text-muted-foreground">
                  {expired
                    ? "Mã đã hết hạn"
                    : `Còn hiệu lực ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`}
                </p>
              )}
              <div className="flex justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Đã copy" : "Copy mã"}
                </button>
                {expired && (
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  >
                    <RefreshCw size={14} /> Lấy mã mới
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2.5 py-4 text-sm">
              <p className="font-medium">Cách dùng</p>
              <ol className="space-y-2 text-muted-foreground">
                <li>1. Mở nhóm Zalo có Zino</li>
                <li>
                  2. Gõ: <span className="font-mono font-semibold text-foreground">@Zino {state.code}</span>
                </li>
                <li>3. Zino trả lời xác nhận — màn này tự chuyển</li>
              </ol>
              <p className="pt-1 text-xs text-muted-foreground">
                Zino nhận ra bạn qua chính tin nhắn đó, nên không ai có thể nhận vơ là bạn.
              </p>
            </CardContent>
          </Card>

          <p className="flex items-center justify-center gap-2 pb-4 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            Đang chờ bạn gõ mã trong nhóm…
          </p>
        </>
      )}

      {!state && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">Đang lấy mã…</p>
      )}
    </div>
  );
}
