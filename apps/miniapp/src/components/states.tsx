import type { ReactNode } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Card, CardContent } from "./ui/card";

/**
 * Ba trạng thái mà mọi màn đều phải có: đang tải, lỗi, và rỗng.
 *
 * Quan trọng nhất là phân biệt LỖI với RỖNG. Bản trước gộp cả hai thành một
 * màn trống, nên API chết cũng hiện đúng câu "chưa có chuyến đi nào" — vừa
 * làm user tưởng app hoạt động bình thường, vừa làm chính team mất thời gian
 * mò lỗi.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

/** Khung xương thay cho chữ "Đang tải…" — mắt bớt giật khi dữ liệu về. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2 py-4">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <WifiOff size={28} className="text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Chưa lấy được dữ liệu</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground active:opacity-90"
        >
          <RefreshCw size={14} /> Thử lại
        </button>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  hint
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        {icon}
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint && <p className="max-w-[34ch] text-xs leading-relaxed">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}
