import { NavLink } from "react-router-dom";
import { Bot, CalendarDays, Home, Images, Wallet } from "lucide-react";
import { useTripSearch } from "../lib/active-trip";
import { cn } from "../lib/utils";

/**
 * Bốn tab, đúng theo wireframe: Tổng quan · Lịch trình · Chi phí · Kỷ niệm.
 *
 * "Đối tác" đã bỏ khỏi thanh dưới. Nó không phải một nơi người dùng muốn tới —
 * nó là bước giữa của việc "nhờ Zino hỏi chỗ này". Để nó ngang hàng với Chi phí
 * là nói sai về tần suất dùng. Route /partners vẫn còn, vào từ Trang chủ.
 */
const tabs = [
  { to: "/", label: "Tổng quan", icon: Home },
  { to: "/itinerary", label: "Lịch trình", icon: CalendarDays },
  { to: "/chat", label: "Hỏi Zino", icon: Bot },
  { to: "/expenses", label: "Chi phí", icon: Wallet },
  { to: "/gallery", label: "Kỷ niệm", icon: Images }
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
