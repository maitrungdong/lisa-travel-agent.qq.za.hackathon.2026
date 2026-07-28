import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Global, Logger, Module, type OnApplicationBootstrap } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Inject } from "@nestjs/common";
import { Pool } from "pg";
import * as schema from "./schema";

export const DB = Symbol("DB");
export type Database = NodePgDatabase<typeof schema>;

/**
 * Chạy bootstrap.sql lúc khởi động.
 *
 * File SQL viết idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 * nên chạy mỗi lần boot đều an toàn. Cách này bỏ được drizzle-kit khỏi đường
 * deploy — drizzle-kit cần esbuild native khớp platform, thêm một thứ dễ hỏng
 * vào đúng lúc không nên hỏng.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Database => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL ?? "postgres://zino:zino@localhost:5432/zino"
        });
        return drizzle(pool, { schema });
      }
    }
  ],
  exports: [DB]
})
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly log = new Logger(DatabaseModule.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.DB_AUTO_MIGRATE === "0") return;
    try {
      // dist/ giữ nguyên cây thư mục src/ nên đường dẫn tương đối dùng chung được
      const path = join(__dirname, "bootstrap.sql");
      const ddl = await readFile(path, "utf8");
      await this.db.execute(sql.raw(ddl));
      this.log.log("Schema đã đồng bộ");
    } catch (err) {
      this.log.error(`Không chạy được bootstrap.sql: ${(err as Error).message}`);
      throw err; // schema sai thì đừng chạy tiếp, hỏng sớm dễ sửa hơn
    }
  }
}
