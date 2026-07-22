import { NavLink } from "react-router-dom";
import { CalendarDays, Home, Images, Wallet } from "lucide-react";
import { cn } from "../lib/utils";

const tabs = [
  { to: "/", label: "Trang chủ", icon: Home },
  { to: "/itinerary", label: "Lịch trình", icon: CalendarDays },
  { to: "/expenses", label: "Chi phí", icon: Wallet },
  { to: "/gallery", label: "Kỷ niệm", icon: Images }
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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
