import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { SensorReading } from "@/lib/types";

const LIVING_ROOM = "\uAC70\uC2E4";
const BALCONY = "\uBCA0\uB780\uB2E4";
const ALLOWED_LOCATIONS = [LIVING_ROOM, BALCONY];

function isAuthorized(request: Request) {
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) return false;

  const url = new URL(request.url);
  const providedToken = request.headers.get("x-device-token") || url.searchParams.get("token");
  return providedToken === expectedToken;
}

/**
 * 토양수분은 "측정 안 함"(null)과 "완전히 말랐음"(0)을 구분해야 하는데,
 * 기존 테이블은 not null default 0이라 미측정이 0으로 둔갑했다.
 * 손으로 SQL을 돌리지 않아도 되도록 프로세스당 한 번 정리한다.
 */
let columnsReady: Promise<void> | null = null;

function ensureSensorColumns() {
  if (!columnsReady) {
    columnsReady = migrateSensorColumns().catch((error) => {
      columnsReady = null;
      throw error;
    });
  }
  return columnsReady;
}

async function migrateSensorColumns() {
  await query("alter table sensor_readings add column if not exists soil_moisture_pct numeric(5, 2)");
  await query("alter table sensor_readings alter column soil_moisture_pct drop not null");
  await query("alter table sensor_readings alter column soil_moisture_pct drop default");
}

export async function GET() {
  await ensureSensorColumns();

  // 이전에는 location별 최신 1건만 반환해서 전용 토양센서 장치의 값이 통째로 빠졌고,
  // 그 결과 토양수분 화면이 항상 "수신 대기"로 남았다. 이제 장치별 최신값을 모두 반환한다.
  const readings = await query<SensorReading>(
    `select distinct on (device_id)
       id,
       location,
       device_id,
       temperature_c::float8 as temperature_c,
       humidity_pct::float8 as humidity_pct,
       light_lux,
       soil_moisture_pct::float8 as soil_moisture_pct,
       recorded_at
     from sensor_readings
     where location in ($1, $2)
     order by device_id, recorded_at desc`,
    [LIVING_ROOM, BALCONY],
  );

  return NextResponse.json({ readings });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 401 });
  }

  await ensureSensorColumns();

  // 펌웨어가 센서 오류로 NaN을 담아 보내면 JSON 자체가 깨진다.
  // 예전에는 여기서 예외가 그대로 터져 500이 났고, 기기는 원인을 알 수 없었다.
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const location = String(body.location ?? BALCONY);

  if (!ALLOWED_LOCATIONS.includes(location)) {
    return NextResponse.json({ error: "location must be living room or balcony." }, { status: 400 });
  }

  const temperature = Number(body.temperature_c ?? body.temperature ?? body.temp);
  const humidity = Number(body.humidity_pct ?? body.humidity ?? body.humi);
  const light = Number(body.light_lux ?? body.light);
  const deviceId = String(body.device_id ?? "esp32-balcony-01");

  // 토양수분은 선택값이다. 예전에는 필수라, 토양센서를 떼면 온도·습도·조도까지
  // 통째로 400으로 거부돼 멀쩡한 측정값이 하나도 저장되지 않았다.
  const rawSoil = body.soil_moisture_pct ?? body.soil_moisture ?? body.soil;
  const soilNumber = Number(rawSoil);
  const soilMoisture =
    rawSoil === undefined || rawSoil === null || rawSoil === "" || !Number.isFinite(soilNumber)
      ? null
      : soilNumber;

  if (![temperature, humidity, light].every(Number.isFinite)) {
    return NextResponse.json(
      { error: "temperature_c, humidity_pct, and light_lux must be numbers." },
      { status: 400 },
    );
  }

  const readings = await query<SensorReading>(
    `insert into sensor_readings (location, device_id, temperature_c, humidity_pct, light_lux, soil_moisture_pct, recorded_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))
     returning
       id,
       location,
       device_id,
       temperature_c::float8 as temperature_c,
       humidity_pct::float8 as humidity_pct,
       light_lux,
       soil_moisture_pct::float8 as soil_moisture_pct,
      recorded_at`,
    [
      location,
      deviceId,
      temperature,
      humidity,
      Math.round(light),
      soilMoisture,
      body.recorded_at ?? null,
    ],
  );

  // 자동급수 명령 생성은 실패해도 센서값 저장까지 되돌리면 안 된다.
  // 예전에는 명령 INSERT가 유니크 제약에 걸리면 라우트 전체가 500이 되어,
  // 값은 저장됐는데 기기는 실패로 알고 재전송하는 상태가 됐다.
  let commands: Record<string, unknown>[] = [];
  try {
    commands = await query(
      `insert into pump_commands (plant_id, plant_name, location, pump_device_id, watering_seconds, reason)
       select distinct on (a.pump_device_id)
         p.id,
         p.name,
         $1,
         a.pump_device_id,
         a.watering_seconds,
         'soil moisture ' || $2::text || '% below threshold ' || a.moisture_min_pct::text || '%'
       from plants p
       join plant_automation_configs a on a.plant_id = p.id
       join plant_sensor_configs s on s.plant_id = p.id
       where
         a.enabled = true
         and s.soil_sensor_enabled = true
         and s.soil_sensor_device_id = $3
         and $2::numeric < a.moisture_min_pct
         and (
           a.last_run_at is null
           or a.last_run_at < now() - make_interval(hours => a.cooldown_hours)
         )
         and (
           select count(*)
           from pump_commands c
           where
             -- 물을 실제로 내보내는 주체는 펌프다. 같은 펌프를 여러 식물이 공유하면
             -- 식물별로 세는 순간 상한이 우회된다(A가 상한을 채워도 B로 또 나간다).
             c.pump_device_id = a.pump_device_id
             -- DB 세션이 UTC라 current_date를 쓰면 한국 시간 오전 9시 이전이 전날로 잡혀
             -- '하루 최대'가 실제 하루와 어긋난다.
             and (c.requested_at at time zone 'Asia/Seoul')::date
                 = (now() at time zone 'Asia/Seoul')::date
             -- 회수된(failed) 시도도 실제로 물이 나갔을 수 있으므로 횟수를 소모한다.
             and c.status in ('pending', 'running', 'completed', 'failed')
         ) < a.max_runs_per_day
         -- 한 펌프는 한 번에 하나만 돌 수 있다. 같은 펌프를 여러 식물이 공유하므로
         -- 식물이 아니라 기기 단위로 미처리 명령을 확인해야 유니크 인덱스와 일치한다.
         and not exists (
           select 1
           from pump_commands pending
           where pending.pump_device_id = a.pump_device_id
             and pending.status in ('pending', 'running')
         )
       order by a.pump_device_id, p.name
       on conflict do nothing
       returning id, plant_name, pump_device_id, watering_seconds, reason, status, requested_at`,
      [location, soilMoisture, deviceId],
    );
  } catch (error) {
    console.error("pump command creation skipped:", error);
  }

  const automationCandidates = await query(
    `select
       p.name as plant_name,
       p.location,
       coalesce(a.enabled, false) as automation_enabled,
       a.pump_device_id,
       a.moisture_min_pct::float8 as moisture_min_pct,
       a.watering_seconds,
       a.cooldown_hours,
       a.max_runs_per_day,
       a.last_run_at,
       coalesce(s.soil_sensor_enabled, false) as soil_sensor_enabled,
       s.soil_sensor_device_id,
       exists (
         select 1
         from pump_commands pending
         where pending.plant_id = p.id and pending.status in ('pending', 'running')
       ) as has_open_command
     from plants p
     left join plant_automation_configs a on a.plant_id = p.id
     left join plant_sensor_configs s on s.plant_id = p.id
     where s.soil_sensor_device_id = $1
     order by p.name`,
    [deviceId],
  );

  return NextResponse.json({ reading: readings[0], pumpCommands: commands, automationCandidates }, { status: 201 });
}
