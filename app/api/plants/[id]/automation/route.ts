import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { ensureWateringSecondsLimit } from "@/lib/migrations";

const BALCONY = "\uBCA0\uB780\uB2E4";

/**
 * db/schema.sql의 check 제약과 같은 범위. 벗어난 값을 그대로 넣으면 제약 위반이
 * 잡히지 않은 채 본문 없는 500으로 떨어져, 무엇이 잘못됐는지 화면에 남지 않았다.
 *
 * 세 번째 값은 "정수 칼럼인가". moisture_min_pct만 numeric(5,2)이고 나머지 셋은
 * integer라, 범위 안이어도 소수가 남으면 Postgres가 22P02로 거절한다.
 */
const LIMITS = {
  moisture_min_pct: [1, 100, false],
  watering_seconds: [1, 15, true],
  cooldown_hours: [1, 168, true],
  max_runs_per_day: [1, 12, true],
} as const;

function clamp(value: unknown, key: keyof typeof LIMITS, fallback: number) {
  const [min, max, isInteger] = LIMITS[key];
  // Number(null)·Number("")은 0이라 "값을 안 보냈다"가 0으로 둔갑한다.
  // 그러면 기본값 대신 최솟값이 저장돼, 쿨다운 12시간이 조용히 1시간이 된다.
  const absent =
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "");
  const parsed = absent ? NaN : Number(value);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  const rounded = isInteger ? Math.round(base) : Math.round(base * 100) / 100;
  return Math.min(max, Math.max(min, rounded));
}

type Params = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  await ensureWateringSecondsLimit();

  const { id } = await params;
  const body = await request.json();

  const plant = await queryOne<{ id: string; location: string }>(
    "select id, location from plants where id = $1",
    [id],
  );

  if (!plant) {
    return NextResponse.json({ error: "Plant not found." }, { status: 404 });
  }

  const enabled = Boolean(body.enabled);
  const defaultPump = plant.location === BALCONY ? "pump-balcony-01" : "pump-living-01";

  const configs = await query(
    `insert into plant_automation_configs
       (plant_id, enabled, pump_device_id, moisture_min_pct, watering_seconds, cooldown_hours, max_runs_per_day)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (plant_id) do update set
       enabled = excluded.enabled,
       pump_device_id = excluded.pump_device_id,
       moisture_min_pct = excluded.moisture_min_pct,
       watering_seconds = excluded.watering_seconds,
       cooldown_hours = excluded.cooldown_hours,
       max_runs_per_day = excluded.max_runs_per_day,
       updated_at = now()
     returning
       enabled as automation_enabled,
       pump_device_id,
       moisture_min_pct::float8 as moisture_min_pct,
       watering_seconds,
       cooldown_hours,
       max_runs_per_day`,
    [
      id,
      enabled,
      String(body.pump_device_id ?? defaultPump),
      clamp(body.moisture_min_pct, "moisture_min_pct", 30),
      clamp(body.watering_seconds, "watering_seconds", 5),
      clamp(body.cooldown_hours, "cooldown_hours", 12),
      clamp(body.max_runs_per_day, "max_runs_per_day", 2),
    ],
  );

  return NextResponse.json({ config: configs[0] });
}
