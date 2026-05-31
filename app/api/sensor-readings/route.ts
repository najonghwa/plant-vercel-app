import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { SensorReading } from "@/lib/types";

function isAuthorized(request: Request) {
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) return false;

  const url = new URL(request.url);
  const providedToken = request.headers.get("x-device-token") || url.searchParams.get("token");
  return providedToken === expectedToken;
}

export async function GET() {
  const readings = await query<SensorReading>(
    `select distinct on (location)
       id,
       location,
       device_id,
       temperature_c::float8 as temperature_c,
       humidity_pct::float8 as humidity_pct,
       light_lux,
       soil_moisture_pct::float8 as soil_moisture_pct,
       recorded_at
     from sensor_readings
     where location in ('거실', '베란다')
     order by location, recorded_at desc`,
  );

  return NextResponse.json({ readings });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "인증 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  const body = await request.json();
  const location = String(body.location ?? "베란다");

  if (!["거실", "베란다"].includes(location)) {
    return NextResponse.json({ error: "location은 거실 또는 베란다만 가능합니다." }, { status: 400 });
  }

  const temperature = Number(body.temperature_c ?? body.temperature ?? body.temp);
  const humidity = Number(body.humidity_pct ?? body.humidity ?? body.humi);
  const light = Number(body.light_lux ?? body.light);
  const soilMoisture = Number(body.soil_moisture_pct ?? body.soil_moisture ?? body.soil);

  if (![temperature, humidity, light, soilMoisture].every(Number.isFinite)) {
    return NextResponse.json({ error: "temperature_c, humidity_pct, light_lux, soil_moisture_pct 숫자 값이 필요합니다." }, { status: 400 });
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
      String(body.device_id ?? "esp32-balcony-01"),
      temperature,
      humidity,
      Math.round(light),
      soilMoisture,
      body.recorded_at ?? null,
    ],
  );

  const commands = await query(
    `insert into pump_commands (plant_id, plant_name, location, pump_device_id, watering_seconds, reason)
     select
       p.id,
       p.name,
       p.location,
       a.pump_device_id,
       a.watering_seconds,
       'soil moisture ' || $2::text || '% below threshold ' || a.moisture_min_pct::text || '%'
     from plants p
     join plant_automation_configs a on a.plant_id = p.id
     where
       p.location = $1
       and a.enabled = true
       and $2::numeric < a.moisture_min_pct
       and (
         a.last_run_at is null
         or a.last_run_at < now() - make_interval(hours => a.cooldown_hours)
       )
       and (
         select count(*)
         from pump_commands c
         where
           c.plant_id = p.id
           and c.requested_at::date = current_date
           and c.status in ('pending', 'running', 'completed')
       ) < a.max_runs_per_day
       and not exists (
         select 1
         from pump_commands pending
         where pending.plant_id = p.id and pending.status in ('pending', 'running')
       )
     returning id, plant_name, pump_device_id, watering_seconds, reason, status, requested_at`,
    [location, soilMoisture],
  );

  return NextResponse.json({ reading: readings[0], pumpCommands: commands }, { status: 201 });
}
