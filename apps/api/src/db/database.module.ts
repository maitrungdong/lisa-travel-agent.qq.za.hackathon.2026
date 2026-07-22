import { Global, Module } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const DB = Symbol("DB");
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Database => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL ?? "postgres://lisa:lisa@localhost:5432/lisa"
        });
        return drizzle(pool, { schema });
      }
    }
  ],
  exports: [DB]
})
export class DatabaseModule {}
