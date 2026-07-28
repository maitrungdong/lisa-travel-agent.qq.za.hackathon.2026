import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { activities, events, expenses, members, notes, photos, trips } from "./schema";

/**
 * Seed một chuyến đi hoàn chỉnh để test giao diện.
 *
 * Vì sao cần: các endpoint ghi dữ liệu chỉ có cho trip/event/expense/activity —
 * members, photos, notes do agent ghi thẳng qua tool. Không có script này thì
 * mở Mini App chỉ thấy màn rỗng, không kiểm được thanh ngân sách, chia tiền,
 * gallery hay trang tổng kết.
 *
 * Chạy:  pnpm --filter api exec tsx src/db/seed-demo-trip.ts
 * Chạy lại được nhiều lần: xoá sạch chuyến cũ cùng tên rồi tạo lại.
 *
 * Ảnh lấy từ picsum.photos → cần mạng. Không có mạng thì ảnh vỡ, phần còn lại
 * vẫn chạy bình thường.
 */

const TRIP_NAME = "Vũng Tàu quẩy tới bến (demo)";

/** Ngày N của chuyến, giờ VN → Date UTC. */
function ict(dayOffset: number, hhmm: string): Date {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  const [h, m] = hhmm.split(":").map(Number);
  // Neo vào "hôm nay" để đếm ngược và tab ngày luôn có ngày chưa qua
  return new Date(base.getTime() + dayOffset * 86_400_000 + (h - 7) * 3_600_000 + m * 60_000);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Dọn chuyến cũ trước — chạy seed 3 lần không đẻ ra 3 chuyến trùng tên
  const old = await db.select().from(trips).where(eq(trips.name, TRIP_NAME));
  for (const t of old) {
    await db.delete(activities).where(eq(activities.tripId, t.id));
    await db.delete(photos).where(eq(photos.tripId, t.id));
    await db.delete(notes).where(eq(notes.tripId, t.id));
    await db.delete(expenses).where(eq(expenses.tripId, t.id));
    await db.delete(events).where(eq(events.tripId, t.id));
    await db.delete(members).where(eq(members.tripId, t.id));
    await db.delete(trips).where(eq(trips.id, t.id));
  }

  const [trip] = await db
    .insert(trips)
    .values({
      name: TRIP_NAME,
      destination: "Vũng Tàu",
      startDate: ict(0, "08:00"),
      endDate: ict(2, "17:00"),
      status: "ongoing",
      budgetPerPerson: 3_000_000,
      notes: "Đông dị ứng tôm — mọi quán hải sản phải có món khác."
    })
    .returning();

  await db.insert(members).values([
    { tripId: trip.id, zaloUserId: "u1", displayName: "Đông" },
    { tripId: trip.id, zaloUserId: "u2", displayName: "Đạt" },
    { tripId: trip.id, zaloUserId: "u3", displayName: "Linh" }
  ]);

  await db.insert(events).values([
    {
      tripId: trip.id,
      title: "Xuất phát từ Sài Gòn",
      startsAt: ict(0, "08:00"),
      location: "Bến xe Miền Đông",
      kind: "transport",
      note: "Limousine 9 chỗ, đã đặt trước",
      estimatedCost: 1_200_000
    },
    {
      tripId: trip.id,
      title: "Nhận phòng Malibu Hotel",
      startsAt: ict(0, "14:00"),
      location: "Khách sạn Malibu, Bãi Sau",
      kind: "stay",
      note: "3 phòng đôi, có ăn sáng",
      estimatedCost: 3_600_000
    },
    {
      tripId: trip.id,
      title: "Hải sản Gành Hào",
      startsAt: ict(0, "18:30"),
      location: "3 Trần Phú",
      kind: "food",
      note: "Nhớ đặt thêm món không hải sản cho Đông",
      estimatedCost: 1_400_000
    },
    // 00:30 giờ VN — mốc kiểm tra việc gom ngày theo ICT chứ không theo UTC
    {
      tripId: trip.id,
      title: "Ngắm bình minh Bãi Sau",
      startsAt: ict(1, "05:15"),
      location: "Bãi Sau",
      kind: "activity",
      note: null,
      estimatedCost: null
    },
    {
      tripId: trip.id,
      title: "Leo Ngọn Hải Đăng",
      startsAt: ict(1, "09:00"),
      location: "Núi Nhỏ",
      kind: "activity",
      note: "Đi bộ ~20 phút, mang nước",
      estimatedCost: 100_000
    },
    {
      tripId: trip.id,
      title: "Cà phê view biển",
      startsAt: ict(1, "16:00"),
      location: "Bãi Trước",
      kind: "food",
      note: null,
      estimatedCost: 300_000
    },
    {
      tripId: trip.id,
      title: "Trả phòng, về Sài Gòn",
      startsAt: ict(2, "12:00"),
      location: null,
      kind: "transport",
      note: null,
      estimatedCost: null
    }
  ]);

  await db.insert(expenses).values([
    {
      tripId: trip.id,
      title: "Xe limousine 2 chiều",
      amount: 2_400_000,
      category: "transport",
      paidBy: "u1",
      paidByName: "Đông",
      spentAt: ict(0, "08:10")
    },
    {
      tripId: trip.id,
      title: "Khách sạn 2 đêm",
      amount: 3_600_000,
      category: "stay",
      paidBy: "u1",
      paidByName: "Đông",
      spentAt: ict(0, "14:30")
    },
    {
      tripId: trip.id,
      title: "Hải sản Gành Hào",
      amount: 1_400_000,
      category: "food",
      paidBy: "u2",
      paidByName: "Đạt",
      spentAt: ict(0, "20:00")
    },
    {
      tripId: trip.id,
      title: "Vé hải đăng + cà phê",
      amount: 600_000,
      category: "ticket",
      paidBy: "u3",
      paidByName: "Linh",
      spentAt: ict(1, "10:00")
    }
  ]);

  await db.insert(photos).values([
    {
      tripId: trip.id,
      url: "https://picsum.photos/seed/vungtau1/800/800",
      caption: "Bình minh Bãi Sau, đáng để dậy 5 giờ",
      uploaderZaloId: "u3",
      uploaderName: "Linh",
      takenAt: ict(1, "05:40")
    },
    {
      tripId: trip.id,
      url: "https://picsum.photos/seed/vungtau2/800/800",
      caption: "Mâm hải sản Gành Hào",
      uploaderZaloId: "u2",
      uploaderName: "Đạt",
      takenAt: ict(0, "19:20")
    },
    {
      tripId: trip.id,
      url: "https://picsum.photos/seed/vungtau3/800/800",
      caption: null,
      uploaderZaloId: "u1",
      uploaderName: "Đông",
      takenAt: ict(1, "09:45")
    },
    {
      tripId: trip.id,
      url: "https://picsum.photos/seed/vungtau4/800/800",
      caption: "Cà phê Bãi Trước lúc chiều xuống",
      uploaderZaloId: "u3",
      uploaderName: "Linh",
      takenAt: ict(1, "16:30")
    }
  ]);

  await db.insert(notes).values([
    {
      tripId: trip.id,
      authorZaloId: "u1",
      authorName: "Zino",
      content: "Đông dị ứng tôm — đã dặn quán đổi sang mực và cá.",
      kind: "note",
      takenAt: ict(0, "18:00")
    },
    {
      tripId: trip.id,
      authorZaloId: "u3",
      authorName: "Linh",
      content: "Hải đăng đông lúc 9h, lần sau đi sớm hơn 1 tiếng.",
      kind: "tip",
      takenAt: ict(1, "10:30")
    }
  ]);

  await db.insert(activities).values([
    { tripId: trip.id, kind: "plan", content: "Đã research và dựng lịch trình 3 ngày cho Vũng Tàu" },
    { tripId: trip.id, kind: "expense", content: "Đọc hoá đơn Gành Hào: 1.400.000₫, chia đều 3 người" },
    { tripId: trip.id, kind: "suggestion", content: "Gợi ý Khách sạn Malibu — OA đã xác thực, gần Bãi Sau" },
    { tripId: trip.id, kind: "reminder", content: "Nhắc trả phòng trước 12h trưa ngày cuối" }
  ]);

  console.log(`✅ Đã seed chuyến demo id=${trip.id}`);
  console.log(`   Mini App:      http://localhost:5173/#/?trip=${trip.id}`);
  console.log(`   Trang tổng kết: http://localhost:3000/trips/${trip.id}/recap.html`);
  await pool.end();
}

void main();
