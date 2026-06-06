import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

const BALCONY = "\uBCA0\uB780\uB2E4";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: Params) {
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
      Number(body.moisture_min_pct ?? 30),
      Number(body.watering_seconds ?? 5),
      Number(body.cooldown_hours ?? 12),
      Number(body.max_runs_per_day ?? 2),
    ],
  );

  return NextResponse.json({ config: configs[0] });
}
