import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { Plant } from "@/lib/types";

export async function GET() {
  const plants = await query<Plant>(
    `select
       p.id,
       p.name,
       p.category,
       p.location,
       p.water_level,
       p.sunlight,
       p.memo,
       coalesce(a.enabled, false) as automation_enabled,
       a.pump_device_id,
       a.moisture_min_pct::float8 as moisture_min_pct,
       a.watering_seconds,
       a.cooldown_hours,
       a.max_runs_per_day,
       p.created_at,
       p.updated_at
     from plants p
     left join plant_automation_configs a on a.plant_id = p.id
     order by p.location, p.name`,
  );

  return NextResponse.json({ plants });
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body.name ?? "").trim();
  const location = String(body.location ?? "거실");

  if (!name) {
    return NextResponse.json({ error: "식물 이름이 필요합니다." }, { status: 400 });
  }

  if (!["거실", "베란다"].includes(location)) {
    return NextResponse.json({ error: "location은 거실 또는 베란다만 가능합니다." }, { status: 400 });
  }

  const plants = await query<Plant>(
    `insert into plants (name, category, location, water_level, sunlight, memo)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, category, location, water_level, sunlight, memo, created_at, updated_at`,
    [
      name,
      String(body.category ?? ""),
      location,
      String(body.water_level ?? "보통"),
      String(body.sunlight ?? ""),
      String(body.memo ?? ""),
    ],
  );

  const automationEnabled = Boolean(body.automation_enabled);
  if (automationEnabled) {
    await query(
      `insert into plant_automation_configs
         (plant_id, enabled, pump_device_id, moisture_min_pct, watering_seconds, cooldown_hours, max_runs_per_day)
       values ($1, true, $2, $3, $4, $5, $6)
       on conflict (plant_id) do update set
         enabled = excluded.enabled,
         pump_device_id = excluded.pump_device_id,
         moisture_min_pct = excluded.moisture_min_pct,
         watering_seconds = excluded.watering_seconds,
         cooldown_hours = excluded.cooldown_hours,
         max_runs_per_day = excluded.max_runs_per_day,
         updated_at = now()`,
      [
        plants[0].id,
        String(body.pump_device_id ?? (location === "베란다" ? "pump-balcony-01" : "pump-living-01")),
        Number(body.moisture_min_pct ?? 30),
        Number(body.watering_seconds ?? 5),
        Number(body.cooldown_hours ?? 12),
        Number(body.max_runs_per_day ?? 2),
      ],
    );
  }

  return NextResponse.json(
    {
      plant: {
        ...plants[0],
        automation_enabled: automationEnabled,
        pump_device_id: automationEnabled ? String(body.pump_device_id ?? (location === "베란다" ? "pump-balcony-01" : "pump-living-01")) : null,
        moisture_min_pct: automationEnabled ? Number(body.moisture_min_pct ?? 30) : null,
        watering_seconds: automationEnabled ? Number(body.watering_seconds ?? 5) : null,
        cooldown_hours: automationEnabled ? Number(body.cooldown_hours ?? 12) : null,
        max_runs_per_day: automationEnabled ? Number(body.max_runs_per_day ?? 2) : null,
      },
    },
    { status: 201 },
  );
}
