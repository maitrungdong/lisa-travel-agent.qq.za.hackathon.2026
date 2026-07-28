import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
const MAX_BYTES = 12 * 1024 * 1024;

export interface StoredMedia {
  /** URL công khai — dùng lại được cho sendPhoto và cho mini app */
  url: string;
  path: string;
  mimeType: string;
  bytes: number;
}

/**
 * Lưu ảnh user gửi.
 *
 * ⚠ Vì sao phải tải NGAY khi nhận webhook:
 *  `message.photo_url` của Zalo là URL tạm — tài liệu không cam kết tuổi thọ.
 *  Nếu đợi tới lúc agent xử lý mới tải thì có thể đã 404. Tải trước, hỏi sau.
 *
 * Ảnh lưu ở /data/media (mount từ /opt/zino/media), nginx serve lại tại
 * {PUBLIC_BASE_URL}/media/... để Zalo fetch được khi sendPhoto.
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name);

  /** Tải ảnh từ URL tạm của Zalo về host mình. Trả null nếu hỏng. */
  async download(sourceUrl: string): Promise<StoredMedia | null> {
    try {
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        this.log.warn(`Tải ảnh thất bại ${res.status}: ${sourceUrl}`);
        return null;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        this.log.warn(`Ảnh quá lớn (${buf.byteLength} bytes), bỏ qua`);
        return null;
      }

      const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      const ext = pickExtension(mimeType, sourceUrl);
      const name = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${ext}`;

      await mkdir(MEDIA_DIR, { recursive: true });
      const path = join(MEDIA_DIR, name);
      await writeFile(path, buf);

      return {
        url: `${PUBLIC_BASE_URL.replace(/\/$/, "")}/media/${name}`,
        path,
        mimeType,
        bytes: buf.byteLength
      };
    } catch (err) {
      this.log.error(`Lỗi tải ảnh: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Đọc ảnh đã lưu thành base64 để nhét vào content block của Claude.
   * Đây là cách "OCR" — không cần dịch vụ OCR riêng, Claude vision đọc thẳng.
   */
  async toBase64(path: string): Promise<string | null> {
    try {
      const buf = await readFile(path);
      return buf.toString("base64");
    } catch {
      return null;
    }
  }

  /**
   * URL công khai → đường dẫn file trên đĩa.
   * Chỉ nhận tên file thuần (chặn `..` và dấu `/`) để không đọc ra ngoài MEDIA_DIR.
   */
  pathFromUrl(url: string): string | null {
    const name = url.split("/").pop();
    if (!name || name.includes("..") || name.includes("\\")) return null;
    return join(MEDIA_DIR, name);
  }

  /** Ghi file HTML trang tổng kết chuyến đi, trả URL công khai. */
  async writeRecap(tripId: number, html: string): Promise<string> {
    const dir = join(process.env.RECAP_DIR ?? "/data/recap", String(tripId));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), html, "utf8");
    return `${PUBLIC_BASE_URL.replace(/\/$/, "")}/trip/${tripId}/`;
  }
}

/** Claude vision chỉ nhận jpeg/png/gif/webp — quy về 1 trong 4. */
function pickExtension(mimeType: string, url: string): string {
  const byMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp"
  };
  if (byMime[mimeType]) return byMime[mimeType];
  const fromUrl = extname(new URL(url, "https://x").pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fromUrl) ? fromUrl : ".jpg";
}

/** Chuẩn hoá mime cho Claude vision API. */
export function visionMime(mimeType: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/gif") return "image/gif";
  if (mimeType === "image/webp") return "image/webp";
  return "image/jpeg";
}
