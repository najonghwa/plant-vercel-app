import { NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";

const BALCONY = "\uBCA0\uB780\uB2E4";
const RUCOLA = "\uB8E8\uAF34\uB77C";

function isAuthorized(request: Request) {
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) return false;

  const url = new URL(request.url);
  const providedToken = request.headers.get("x-device-token") || url.searchParams.get("token");
  return providedToken === expectedToken;
}

/**
 * 일회성 셋업 라우트. 자동급수 설정과 식물 위치를 덮어쓰므로 토큰을 요구하고,
 * 주소를 여는 것만으로 실행되지 않도록 POST로 둔다.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 401 });
  }

  const plant = await queryOne<{ id: string; name: string }>(
    `select id, name
     from plants
     where name = $1
     order by created_at desc
     limit 1`,
    [RUCOLA],
  );

  if (!plant) {
    return NextResponse.json({ ok: false, error: "Rucola plant was not found." }, { status: 404 });
  }

  // 세 단계를 따로 실행하면, 가운데에서 실패했을 때 "센서는 연결됐는데 자동급수는 없는"
  // 반쪽 상태가 그대로 남는다. 한 트랜잭션으로 묶는다.
  const configs = await withTransaction(async (tx) => {
    await tx(
      `insert into plant_sensor_configs (plant_id, soil_sensor_enabled, soil_sensor_device_id)
       values ($1, true, 'esp32-balcony-01')
       on conflict (plant_id) do update set
         soil_sensor_enabled = true,
         soil_sensor_device_id = 'esp32-balcony-01',
         updated_at = now()`,
      [plant.id],
    );

    // cooldown_hours는 DB check 제약이 1 이상이라 0을 넣으면 라우트 전체가 500이 났다.
    // 하루 1회가 목적이므로 24가 의도에 맞는다.
    const rows = await tx(
      `insert into plant_automation_configs
         (plant_id, enabled, pump_device_id, moisture_min_pct, watering_seconds, cooldown_hours, max_runs_per_day)
       values ($1, true, 'pump-balcony-01', 5, 10, 24, 1)
       on conflict (plant_id) do update set
         enabled = true,
         pump_device_id = 'pump-balcony-01',
         moisture_min_pct = 5,
         watering_seconds = 10,
         cooldown_hours = 24,
         max_runs_per_day = 1,
         updated_at = now()
       returning
         enabled,
         pump_device_id,
         moisture_min_pct::float8 as moisture_min_pct,
         watering_seconds,
         cooldown_hours,
         max_runs_per_day`,
      [plant.id],
    );

    await tx(
      `update plants
       set location = $2, updated_at = now()
       where id = $1`,
      [plant.id, BALCONY],
    );

    return rows;
  });

  return NextResponse.json({
    ok: true,
    plant: plant.name,
    soil_sensor_device_id: "esp32-balcony-01",
    automation: configs[0],
    note: "Rucola will water for 10 seconds when soil moisture is below 5%, at most once per day.",
  });
}
