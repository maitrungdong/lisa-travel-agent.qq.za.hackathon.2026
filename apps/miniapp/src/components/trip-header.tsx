import { CalendarDays, MapPin } from "lucide-react";
import type { Trip } from "../lib/api";
import { daysUntil } from "../lib/use-trip";
import { formatDate } from "../lib/utils";
import { TripSwitcher } from "./trip-switcher";
import { Badge } from "./ui/badge";

export const STATUS_LABEL: Record<string, string> = {
  planning: "Đang lên kế hoạch",
  confirmed: "Đã chốt",
  ongoing: "Đang đi",
  done: "Đã xong"
};

/** Đếm ngược / trạng thái theo thời gian thực — câu chữ tự nhiên như người nói. */
export function countdownLabel(trip: Trip, now: Date = new Date()): string {
  const toStart = daysUntil(trip.startDate, now);
  const toEnd = daysUntil(trip.endDate, now);
  if (toStart > 1) return `Còn ${toStart} ngày nữa`;
  if (toStart === 1) return "Mai lên đường!";
  if (toStart === 0) return "Hôm nay khởi hành 🎒";
  if (toEnd >= 0) return "Đang trong chuyến đi";
  return `Đã đi cách đây ${Math.abs(toEnd)} ngày`;
}

/**
 * Thanh ngữ cảnh chuyến đi, đặt trên đầu mọi tab.
 * Nhóm có thể đi nhiều chuyến; không có dòng này thì người dùng không biết
 * bảng chi tiêu đang là của chuyến nào.
 *
 * Tên chuyến đồng thời là nút đổi chuyến (xem `TripSwitcher`) — chỉ mọc mũi tên
 * khi nhóm có từ hai chuyến trở lên.
 */
export function TripHeader({ trip }: { trip: Trip }) {
  return (
    // Trước đây tên chuyến và badge nằm chung một hàng, nút đổi chuyến phải
    // chen vào giữa. Tách hai tầng: tầng trên là control, tầng dưới là thông
    // tin — nút mới có chỗ để trông ra nút.
    <header className="space-y-2 rounded-lg border border-border bg-card p-3.5">
      <TripSwitcher currentTripId={trip.id}>
        <h1 className="truncate text-base font-bold">{trip.name}</h1>
      </TripSwitcher>
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin size={12} className="shrink-0" />
          {trip.destination}
          <span className="mx-0.5">·</span>
          <CalendarDays size={12} className="shrink-0" />
          {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
        </p>
        <Badge variant={trip.status === "done" ? "secondary" : "default"} className="shrink-0">
          {STATUS_LABEL[trip.status] ?? trip.status}
        </Badge>
      </div>
    </header>
  );
}
