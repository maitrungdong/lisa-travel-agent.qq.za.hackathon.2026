/** Nối class có điều kiện — bản mini của clsx, đủ dùng cho app. */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/**
 * Chia đều chi phí cho các thành viên, phần dư dồn vào người đầu tiên
 * để tổng luôn khớp từng đồng.
 */
export function splitEvenly(total: number, memberCount: number): number[] {
  if (memberCount <= 0) throw new Error("memberCount phải > 0");
  const base = Math.floor(total / memberCount);
  const remainder = total - base * memberCount;
  return Array.from({ length: memberCount }, (_, i) => (i === 0 ? base + remainder : base));
}
