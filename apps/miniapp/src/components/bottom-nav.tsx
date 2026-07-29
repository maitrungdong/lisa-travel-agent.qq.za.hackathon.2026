import { NavLink } from "react-router-dom";
import { Bot, CalendarDays, Home, Luggage, Wallet } from "lucide-react";
import { useTripSearch } from "../lib/active-trip";
import { cn } from "../lib/utils";

/**
 * Năm tab: Tổng quan · Lịch trình · Hỏi Zino · Chi phí · Đặt chỗ.
 *
 * Nguyên tắc chọn: thanh dưới dành cho nơi có VIỆC CẦN LÀM, không phải nơi để
 * ngắm.
 *
 *  • "Đối tác" bỏ từ trước — nó là bước giữa của việc "nhờ Zino hỏi chỗ này",
 *    không phải đích đến. Route /partners vẫn còn, vào từ Trang chủ.
 *  • "Kỷ niệm" nhường chỗ cho "Đặt chỗ". Ảnh là thứ xem lại sau chuyến, và
 *    trang tổng kết đã trình bày đầy đủ hơn hẳn; còn đặt chỗ là việc tồn đọng
 *    có hạn chót. Một ô ở thanh dưới đáng giá hơn khi nó nhắc được việc.
 *    Route /gallery vẫn còn, vào từ lưới lối tắt ở Trang chủ.
 */
const tabs = [
  { to: "/", label: "Tổng quan", icon: Home },
  { to: "/itinerary", label: "Lịch trình", icon: CalendarDays },
  { to: "/chat", label: "Hỏi Zino", icon: Bot },
  { to: "/expenses", label: "Chi phí", icon: Wallet },
  { to: "/bookings", label: "Đặt chỗ", icon: Luggage }
];

export function BottomNav() {
  // Mang `?trip=` sang tab mới. Không có dòng này thì URL sau khi chuyển tab
  // trở nên rỗng nghĩa — copy ra gửi cho người khác là họ mở nhầm chuyến.
  const search = useTripSearch();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={{ pathname: to, search }}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground"
              )
            }
          >
            <Icon size={20} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
