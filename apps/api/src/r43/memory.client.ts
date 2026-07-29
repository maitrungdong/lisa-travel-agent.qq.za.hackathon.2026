import { Injectable, Logger } from "@nestjs/common";
import { envStr } from "../pipeline/pipeline.types";
import { memoryBetaHeader, type SeedFile } from "./r43.types";

const API_BASE = envStr("ANTHROPIC_API_BASE", "https://api.anthropic.com");

/**
 * Client REST cho Memory Store của Managed Agents.
 *
 * VÌ SAO VIẾT TAY: `@anthropic-ai/sdk@0.71.2` KHÔNG có `memory-stores` lẫn
 * `sessions` — đã kiểm, chỉ có `beta/files`. Nên phải gọi REST thô, y như
 * `ManagedAgentDriver` đang làm với session.
 *
 * Đổi sang SDK khi nó hỗ trợ thì chỉ phải sửa trong file này.
 */
@Injectable()
export class MemoryClient {
  private readonly log = new Logger(MemoryClient.name);

  private get apiKey(): string {
    return process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": memoryBetaHeader(),
      "content-type": "application/json"
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.status === 204 ? ({} as T) : ((await res.json()) as T);
  }

  /* ---------------------------------------------------------------- */

  async createStore(input: { name: string; description: string }): Promise<string> {
    const res = await this.request<{ id?: string }>("POST", "/v1/memory_stores", {
      name: input.name,
      description: input.description
    });
    if (!res.id) throw new Error(`Tạo memory store thất bại: ${JSON.stringify(res).slice(0, 200)}`);
    this.log.log(`Tạo memory store ${res.id} · ${input.name}`);
    return res.id;
  }

  /**
   * Seed một store, BỎ QUA đường dẫn đã tồn tại.
   *
   * `memories.create` không ghi đè — doc nói rõ. Nên gọi lại trên store đã seed
   * sẽ trả lỗi trùng, và đó là hành vi ta muốn: handoff §14 yêu cầu "retry chỉ
   * những đường dẫn còn thiếu", không phải xoá làm lại.
   *
   * Nuốt lỗi trùng và ghi log; lỗi khác thì ném lên để caller biết seed hỏng.
   */
  async seed(storeId: string, files: SeedFile[]): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const f of files) {
      try {
        await this.request("POST", `/v1/memory_stores/${storeId}/memories`, {
          path: f.path,
          content: f.content
        });
        created++;
      } catch (err) {
        const msg = (err as Error).message;
        // 409 hoặc thông báo "already exists" → đã seed rồi, đúng ý
        if (/\b409\b|already exist|duplicate/i.test(msg)) {
          skipped++;
          continue;
        }
        throw new Error(`Seed ${f.path} hỏng: ${msg}`);
      }
    }

    this.log.log(`Seed ${storeId}: tạo ${created}, bỏ qua ${skipped} (đã có)`);
    return { created, skipped };
  }

  /* ---------------------------------------------------------------- */
  /* Đọc — dùng cho cầu nối Memory → DB, xem R4_3-IMPLEMENTATION-PLAN §5 */
  /* ---------------------------------------------------------------- */

  async listMemories(
    storeId: string,
    pathPrefix = "/"
  ): Promise<{ id: string; path: string }[]> {
    const q = new URLSearchParams({ path_prefix: pathPrefix });
    const res = await this.request<{ data?: { id: string; path: string }[] }>(
      "GET",
      `/v1/memory_stores/${storeId}/memories?${q}`
    );
    return res.data ?? [];
  }

  /**
   * Đọc nội dung một đường dẫn.
   *
   * API địa chỉ theo `memory_id`, không theo path — nên phải list rồi khớp.
   * Trả null khi không có, vì "chưa có file này" là trạng thái bình thường
   * chứ không phải lỗi (agent chưa kịp ghi lượt nào).
   */
  async readPath(storeId: string, path: string): Promise<string | null> {
    const items = await this.listMemories(storeId, path);
    const hit = items.find((m) => m.path === path);
    if (!hit) return null;
    const res = await this.request<{ content?: string }>(
      "GET",
      `/v1/memory_stores/${storeId}/memories/${hit.id}`
    );
    return res.content ?? null;
  }
}
