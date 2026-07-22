import { Images } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";

export default function GalleryPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Kỷ niệm</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Images size={32} />
          <p className="text-sm">
            Ảnh nhóm chia sẻ trong chuyến đi sẽ được Lisa gom về đây.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
