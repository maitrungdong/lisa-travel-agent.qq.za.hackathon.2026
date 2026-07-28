import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, type Trip } from "../lib/api";
import { fetchZaloUser, type ZaloUser } from "../lib/zalo";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { formatDate } from "../lib/utils";

export default function HomePage() {
  const [user, setUser] = useState<ZaloUser | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchZaloUser().then(setUser);
    api.trips().then(setTrips).catch(() => setError(true));
  }, []);

  return (
    <div className="space-y-4">
      <header className="rounded-lg bg-primary p-5 text-primary-foreground">
        <p className="text-sm/relaxed opacity-80">Xin chào{user ? `, ${user.name}` : ""} 👋</p>
        <h1 className="mt-1 text-xl font-bold">Zino – Trợ lý nhu cầu của nhóm</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm opacity-90">
          <Sparkles size={16} /> Nhắn “@Zino” trong nhóm Zalo để lên kế hoạch
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Chuyến đi của nhóm</h2>
        {error && (
          <Card><CardContent className="py-4 text-sm text-muted-foreground">
            Chưa kết nối được máy chủ — kiểm tra VITE_API_BASE_URL.
          </CardContent></Card>
        )}
        {trips.map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t.name}</CardTitle>
              <Badge variant={t.status === "confirmed" ? "default" : "secondary"}>{t.status}</Badge>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t.destination} · {formatDate(t.startDate)} → {formatDate(t.endDate)}
            </CardContent>
          </Card>
        ))}
        {!error && trips.length === 0 && (
          <Card><CardContent className="py-4 text-sm text-muted-foreground">
            Chưa có chuyến đi nào. Hãy rủ Zino lên kế hoạch trong nhóm Zalo!
          </CardContent></Card>
        )}
      </section>
    </div>
  );
}
