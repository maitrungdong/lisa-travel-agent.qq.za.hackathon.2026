import { HashRouter, Route, Routes } from "react-router-dom";
import { BottomNav } from "./components/bottom-nav";
import BookingsPage from "./pages/bookings";
import ChatPage from "./pages/chat";
import DebugPage from "./pages/debug";
import ExpensesPage from "./pages/expenses";
import GalleryPage from "./pages/gallery";
import HandoffPage from "./pages/handoff";
import HomePage from "./pages/home";
import ItineraryPage from "./pages/itinerary";
import LinkPage from "./pages/link";
import PartnersPage from "./pages/partners";

// HashRouter: bundle chạy dưới sub-path CDN của Zalo, không kiểm soát được
// server routing → hash routing là lựa chọn an toàn nhất.
export default function App() {
  return (
    <HashRouter>
      <main className="mx-auto min-h-dvh max-w-md p-4 pb-24">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/itinerary" element={<ItineraryPage />} />
          {/* Chat trong app — chỗ duy nhất Zino vừa nói vừa đưa nút bấm */}
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          {/* Đặt chỗ — không vào thanh tab (5 mục đã chật), vào từ lối tắt Trang chủ */}
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          {/* Concierge Handoff — Zino soạn tin, user bấm gửi sang OA đối tác */}
          <Route path="/handoff" element={<HandoffPage />} />
          {/* Liên kết tài khoản Zalo với thành viên nhóm — chỉ gặp một lần */}
          <Route path="/link" element={<LinkPage />} />
          {/* TẠM — đo namespace id giữa Bot API và Mini App. Xoá sau khi đo xong. */}
          <Route path="/debug" element={<DebugPage />} />
        </Routes>
      </main>
      <BottomNav />
    </HashRouter>
  );
}
