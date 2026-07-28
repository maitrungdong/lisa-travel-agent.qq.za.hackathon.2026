import { CalendarDays, MapPin } from "lucide-react";
import type { Trip } from "../lib/api";
import { daysUntil } from "../lib/use-trip";
import { formatDate } from "../lib/utils";
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
 */
export function TripHeader({ trip }: { trip: Trip }) {
  return (
    <header className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold">{trip.name}</h1>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin size={12} className="shrink-0" />
            {trip.destination}
            <span className="mx-0.5">·</span>
            <CalendarDays size={12} className="shrink-0" />
            {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
          </p>
        </div>
        <Badge variant={trip.status === "done" ? "secondary" : "default"} className="shrink-0">
          {STATUS_LABEL[trip.status] ?? trip.status}
        </Badge>
      </div>
    </header>
  );
}
