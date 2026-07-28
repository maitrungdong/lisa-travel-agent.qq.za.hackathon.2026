import { useEffect, useState } from "react";
import {
  getAccessToken,
  getAppInfo,
  getContextAsync,
  getRouteParams,
  getUserID,
  getUserInfo
} from "zmp-sdk/apis";
import { Card, CardContent } from "../components/ui/card";

/**
 * MÀN TẠM — đo danh tính, không phải tính năng.
 *
 * Câu hỏi cần trả lời, hiện chưa ai biết đáp án:
 *
 *   1. `getContextAsync()` có trả về ngữ cảnh nhóm không, khi mở app từ
 *      Menu mở rộng trong cửa sổ chat? (Zalo ghi: chỉ hoạt động ở lối vào đó.)
 *   2. `ContextInfo.id` của nhóm CÓ TRÙNG `chat.id` mà Bot API gửi trong
 *      webhook (`zgr-...`) không?
 *   3. `getUserID()` trả về gì, và có trùng `from.id` của Bot API không?
 *
 * Câu 2 và 3 quyết định toàn bộ thiết kế đăng nhập:
 *   trùng  → map nhóm/người tự động, chính thống, không thao tác tay
 *   lệch   → phải có một bước liên kết (mã ghép đôi), một lần cho mỗi người
 *
 * Không đo mà thiết kế thì chỉ là đoán. Đo xong thì XOÁ màn này cùng
 * `debug.controller.ts` bên API.
 */

interface Probe {
  label: string;
  value: string;
  ok: boolean;
}

/** Mỗi API gọi trong try/catch riêng — một cái hỏng không được che mất phần còn lại. */
async function probe(label: string, fn: () => Promise<unknown> | unknown): Promise<Probe> {
  try {
    const v = await fn();
    return {
      label,
      value: typeof v === "string" ? v : JSON.stringify(v, null, 2),
      ok: v !== null && v !== undefined && v !== ""
    };
  } catch (err) {
    return { label, value: err instanceof Error ? err.message : String(err), ok: false };
  }
}

interface DbSnapshot {
  conversations: {
    id: number;
    zaloChatId: string;
    chatType: string;
    title: string | null;
    activeTripId: number | null;
  }[];
  trips: {
    id: number;
    name: string;
    zaloGroupId: string | null;
    members: { zaloUserId: string; displayName: string }[];
  }[];
}

export default function DebugPage() {
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [db, setDb] = useState<DbSnapshot | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  useEffect(() => {
    void (async () => {
      const ctx = await getContextAsync().catch(() => null);
      setContextId(ctx?.id ?? "");

      const uid = await getUserID({}).catch(() => "");
      setUserId(typeof uid === "string" ? uid : "");

      setProbes(
        await Promise.all([
          probe("getContextAsync()", () => getContextAsync()),
          probe("getUserID()", () => getUserID({})),
          probe("getRouteParams()", () => getRouteParams()),
          probe("getAppInfo()", () => getAppInfo({})),
          probe("getUserInfo()", async () => (await getUserInfo({ autoRequestPermission: false })).userInfo),
          probe("getAccessToken() (rút gọn)", async () => {
            const t = await getAccessToken({});
            return typeof t === "string" && t.length > 16 ? `${t.slice(0, 12)}…(${t.length} ký tự)` : t;
          })
        ])
      );
    })();

    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    fetch(`${base}/debug/conversations`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDb)
      .catch((e: unknown) => setDbError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Đây là dòng đáng tiền nhất màn này: khớp hay lệch namespace.
  const groupMatch = contextId
    ? db?.conversations.some((c) => c.zaloChatId === contextId)
    : undefined;
  const userMatch = userId
    ? db?.trips.some((t) => t.members.some((m) => m.zaloUserId === userId))
    : undefined;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold">Debug danh tính</h1>
        <p className="text-sm text-muted-foreground">
          Mở màn này <b>từ Menu mở rộng trong cửa sổ chat nhóm</b> thì mới có ngữ cảnh.
          Mở từ danh sách app của Zalo sẽ ra rỗng — đó là đúng, không phải lỗi.
        </p>
      </header>

      {/* Kết luận trước, chi tiết sau */}
      <Card>
        <CardContent className="space-y-2 py-3.5 text-sm">
          <Verdict
            label="ID nhóm khớp DB?"
            state={groupMatch}
            yes="KHỚP — map nhóm tự động được, khỏi bước thủ công"
            no="LỆCH — Bot API và Mini App khác namespace, cần bước liên kết"
            pending="Chưa có ngữ cảnh nhóm (mở từ menu mở rộng trong nhóm)"
          />
          <Verdict
            label="ID người khớp members?"
            state={userMatch}
            yes="KHỚP — biết ngay bạn là thành viên nào"
            no="LỆCH — cần mã ghép đôi để nối một lần"
            pending="Chưa lấy được getUserID()"
          />
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">zmp-sdk trả về</h2>
        {!probes && <p className="text-sm text-muted-foreground">Đang đo…</p>}
        {probes?.map((p) => (
          <Card key={p.label}>
            <CardContent className="space-y-1 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <span className={p.ok ? "text-emerald-600" : "text-rose-600"}>
                  {p.ok ? "●" : "○"}
                </span>
                {p.label}
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px] leading-relaxed">
                {p.value || "(rỗng)"}
              </pre>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Dữ liệu trong DB</h2>
        {dbError && (
          <Card>
            <CardContent className="py-3 text-sm text-rose-600">
              Không gọi được /debug/conversations: {dbError}
            </CardContent>
          </Card>
        )}
        {db?.conversations.map((c) => (
          <Card key={c.id}>
            <CardContent className="space-y-1 py-3">
              <p className="text-xs font-semibold">
                {c.title ?? "(không tên)"} · {c.chatType}
              </p>
              <pre className="overflow-x-auto break-all rounded bg-muted p-2 text-[11px]">
                zaloChatId: {c.zaloChatId}
              </pre>
            </CardContent>
          </Card>
        ))}
        {db?.trips.map((t) => (
          <Card key={t.id}>
            <CardContent className="space-y-1 py-3">
              <p className="text-xs font-semibold">
                #{t.id} {t.name}
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px] leading-relaxed">
                {t.members.map((m) => `${m.displayName}: ${m.zaloUserId}`).join("\n") ||
                  "(chưa có thành viên)"}
              </pre>
            </CardContent>
          </Card>
        ))}
      </section>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Màn tạm. Đo xong nhớ xoá cả trang này lẫn <code>debug.controller.ts</code>.
      </p>
    </div>
  );
}

function Verdict({
  label,
  state,
  yes,
  no,
  pending
}: {
  label: string;
  state: boolean | undefined;
  yes: string;
  no: string;
  pending: string;
}) {
  const tone =
    state === true
      ? "bg-emerald-50 text-emerald-800"
      : state === false
        ? "bg-amber-50 text-amber-900"
        : "bg-muted text-muted-foreground";
  return (
    <div className={`rounded-lg p-2.5 ${tone}`}>
      <p className="text-xs font-semibold">{label}</p>
      <p className="text-sm">{state === true ? yes : state === false ? no : pending}</p>
    </div>
  );
}
