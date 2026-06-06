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
     where location in ($1, $2)
     order by location, recorded_at desc`,
    [LIVING_ROOM, BALCONY],
  );

  return NextResponse.json({ readings });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 401 });
  }

  const body = await request.json();
  const location = String(body.location ?? BALCONY);

  if (!ALLOWED_LOCATIONS.includes(location)) {
    return NextResponse.json({ error: "location must be living room or balcony." }, { status: 400 });
  }

  const temperature = Number(body.temperature_c ?? body.temperature ?? body.temp);
  const humidity = Number(body.humidity_pct ?? body.humidity ?? body.humi);
  const light = Number(body.light_lux ?? body.light);
  const soilMoisture = Number(body.soil_moisture_pct ?? body.soil_moisture ?? body.soil);
  const deviceId = String(body.device_id ?? "esp32-balcony-01");

  if (![temperature, humidity, light, soilMoisture].every(Number.isFinite)) {
    return NextResponse.json(
      { error: "temperature_c, humidity_pct, light_lux, and soil_moisture_pct must be numbers." },
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

  const commands = await query(
    `insert into pump_commands (plant_id, plant_name, location, pump_device_id, watering_seconds, reason)
     select
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
    [location, soilMoisture, deviceId],
  );

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
