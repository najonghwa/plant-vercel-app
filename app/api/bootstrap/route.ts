import { NextResponse } from "next/server";
import { getPool, query, queryOne } from "@/lib/db";
import { seedPlants, seedWateringLogs } from "@/lib/seed";

const schema = `
create extension if not exists pgcrypto;

create table if not exists plants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default '',
  location text not null check (location in ('거실', '베란다')),
  water_level text not null default '보통',
  sunlight text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists watering_logs (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid references plants(id) on delete set null,
  plant_name text not null,
  watered_at date not null,
  memo text not null default '',
  source text not null default 'manual' check (source in ('manual', 'automation', 'import')),
  created_at timestamptz not null default now()
);

create table if not exists sensor_readings (
  id uuid primary key default gen_random_uuid(),
  location text not null check (location in ('거실', '베란다')),
  device_id text not null,
  temperature_c numeric(5, 2) not null,
  humidity_pct numeric(5, 2) not null,
  light_lux integer not null,
  soil_moisture_pct numeric(5, 2) not null default 0,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table sensor_readings
  add column if not exists soil_moisture_pct numeric(5, 2) not null default 0;

create table if not exists plant_automation_configs (
  plant_id uuid primary key references plants(id) on delete cascade,
  enabled boolean not null default false,
  pump_device_id text not null default 'pump-balcony-01',
  moisture_min_pct numeric(5, 2) not null default 30,
  watering_seconds integer not null default 5 check (watering_seconds between 1 and 30),
  cooldown_hours integer not null default 12 check (cooldown_hours between 1 and 168),
  max_runs_per_day integer not null default 2 check (max_runs_per_day between 1 and 12),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pump_commands (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid references plants(id) on delete set null,
  plant_name text not null,
  location text not null check (location in ('거실', '베란다')),
  pump_device_id text not null,
  watering_seconds integer not null check (watering_seconds between 1 and 30),
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'cancelled', 'failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists watering_logs_plant_date_idx
  on watering_logs (plant_name, watered_at desc);

create index if not exists sensor_readings_location_recorded_idx
  on sensor_readings (location, recorded_at desc);

create index if not exists pump_commands_device_status_idx
  on pump_commands (pump_device_id, status, requested_at desc);
`;

export async function POST() {
  try {
    await getPool().query(schema);

    const plantCount = await queryOne<{ count: string }>("select count(*)::text as count from plants");

    if (plantCount?.count === "0") {
      for (const plant of seedPlants) {
        await query(
          `insert into plants (name, category, location, water_level, sunlight, memo)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (name) do nothing`,
          plant,
        );
      }

      for (const [wateredAt, plantName] of seedWateringLogs) {
        await query(
          `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
           select id, name, $1::date, '', 'import'
           from plants
           where name = $2`,
          [wateredAt, plantName],
        );
      }

      await query(
        `insert into sensor_readings (location, device_id, temperature_c, humidity_pct, light_lux, soil_moisture_pct, recorded_at)
         values
         ('베란다', 'esp32-balcony-01', 21.0, 68.0, 950, 36.0, now()),
         ('거실', 'esp32-living-01', 24.2, 55.0, 420, 42.0, now())`,
      );
    }

    const counts = {
      plants: await queryOne<{ count: string }>("select count(*)::text as count from plants"),
      wateringLogs: await queryOne<{ count: string }>("select count(*)::text as count from watering_logs"),
      sensorReadings: await queryOne<{ count: string }>("select count(*)::text as count from sensor_readings"),
    };

    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bootstrap error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
