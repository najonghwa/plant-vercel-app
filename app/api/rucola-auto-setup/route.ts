import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

const BALCONY = "\uBCA0\uB780\uB2E4";
const RUCOLA = "\uB8E8\uAF34\uB77C";

export async function GET() {
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

  await query(
    `insert into plant_sensor_configs (plant_id, soil_sensor_enabled, soil_sensor_device_id)
     values ($1, true, 'esp32-balcony-01')
     on conflict (plant_id) do update set
       soil_sensor_enabled = true,
       soil_sensor_device_id = 'esp32-balcony-01',
       updated_at = now()`,
    [plant.id],
  );

  const configs = await query(
    `insert into plant_automation_configs
       (plant_id, enabled, pump_device_id, moisture_min_pct, watering_seconds, cooldown_hours, max_runs_per_day)
     values ($1, true, 'pump-balcony-01', 5, 10, 0, 1)
     on conflict (plant_id) do update set
       enabled = true,
       pump_device_id = 'pump-balcony-01',
       moisture_min_pct = 5,
       watering_seconds = 10,
       cooldown_hours = 0,
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

  await query(
    `update plants
     set location = $2, updated_at = now()
     where id = $1`,
    [plant.id, BALCONY],
  );

  return NextResponse.json({
    ok: true,
    plant: plant.name,
    soil_sensor_device_id: "esp32-balcony-01",
    automation: configs[0],
    note: "Rucola will water for 10 seconds when soil moisture is below 5%, at most once per day.",
  });
}
