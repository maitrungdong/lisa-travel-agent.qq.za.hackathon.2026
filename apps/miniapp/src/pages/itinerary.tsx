import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { api, type TripEvent } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";

export default function ItineraryPage() {
  const [events, setEvents] = useState<TripEvent[]>([]);

  useEffect(() => {
    // MVP: timeline của chuyến đi đầu tiên
    api.trips()
      .then((ts) => (ts[0] ? api.events(ts[0].id) : []))
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Lịch trình</h1>
      <ol className="relative ml-3 space-y-4 border-l-2 border-border pl-5">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-primary" />
            <Card>
              <CardContent className="space-y-1 py-3">
                <p className="text-xs font-medium text-primary">
                  {new Date(e.startsAt).toLocaleString("vi-VN", {
                    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit"
                  })}
                </p>
                <p className="font-medium">{e.title}</p>
                {e.location && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin size={14} /> {e.location}
                  </p>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
        {events.length === 0 && (
          <li className="text-sm text-muted-foreground">Lisa sẽ tự cập nhật lịch trình vào đây.</li>
        )}
      </ol>
    </div>
  );
}
