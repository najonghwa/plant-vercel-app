import { Pool } from "pg";

const globalForPool = globalThis as unknown as { plantDbPool?: Pool };

export function getPool() {
  if (globalForPool.plantDbPool) return globalForPool.plantDbPool;

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("POSTGRES_URL 또는 DATABASE_URL 환경변수가 필요합니다.");
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPool.plantDbPool = pool;
  }

  return pool;
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T>(text: string, params: unknown[] = []) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
