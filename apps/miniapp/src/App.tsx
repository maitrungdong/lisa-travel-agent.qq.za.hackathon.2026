import { HashRouter, Route, Routes } from "react-router-dom";
import { BottomNav } from "./components/bottom-nav";
import ExpensesPage from "./pages/expenses";
import GalleryPage from "./pages/gallery";
import HandoffPage from "./pages/handoff";
import HomePage from "./pages/home";
import ItineraryPage from "./pages/itinerary";
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
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          {/* Concierge Handoff — Lisa soạn tin, user bấm gửi sang OA đối tác */}
          <Route path="/handoff" element={<HandoffPage />} />
        </Routes>
      </main>
      <BottomNav />
    </HashRouter>
  );
}
