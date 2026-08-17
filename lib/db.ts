import { Pool } from "pg";

const globalForPool = globalThis as unknown as { plantDbPool?: Pool };

function isLocalConnection(connectionString: string) {
  // 예전에는 "localhost" 문자열만 봐서 127.0.0.1이나 sslmode=disable로 붙으면
  // 불필요하게 SSL을 켜다 연결이 끊겼다.
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get("sslmode") === "disable") return true;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return connectionString.includes("localhost");
  }
}

export function getPool() {
  if (globalForPool.plantDbPool) return globalForPool.plantDbPool;

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("POSTGRES_URL 또는 DATABASE_URL 환경변수가 필요합니다.");
  }

  const pool = new Pool({
    connectionString,
    ssl: isLocalConnection(connectionString) ? false : { rejectUnauthorized: false },
    // 서버리스에서는 인스턴스마다 풀이 따로 생긴다. 기본값 10은 인스턴스가 몇 개만
    // 떠도 DB 최대 연결 수를 금방 넘긴다.
    max: Number(process.env.POSTGRES_POOL_MAX ?? 3),
  });

  // 예전에는 프로덕션에서만 캐시를 하지 않아, 모듈이 다시 평가될 때마다 풀이 새로
  // 만들어지고 이전 풀의 연결은 반환되지 않은 채 남았다. 항상 재사용한다.
  globalForPool.plantDbPool = pool;

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

type TransactionQuery = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/**
 * 여러 write가 한 덩어리로 성립해야 하는 곳에서 쓴다.
 * 중간에 실패하면 앞선 write까지 되돌려, 반쯤 적용된 상태가 남지 않게 한다.
 */
export async function withTransaction<R>(run: (tx: TransactionQuery) => Promise<R>): Promise<R> {
  const client = await getPool().connect();
  const tx: TransactionQuery = async (text, params = []) => {
    const result = await client.query(text, params);
    return result.rows;
  };

  try {
    await client.query("begin");
    const value = await run(tx);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
