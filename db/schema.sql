create extension if not exists pgcrypto;

create table if not exists plants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default '',
  location text not null check (location in ('거실', '베란다')),
  water_level text not null default '보통',
  sunlight text not null default '',
  memo text not null default '',
  difficulty text not null default '',
  environment_recommendation text not null default '',
  care_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plants add column if not exists difficulty text not null default '';
alter table plants add column if not exists environment_recommendation text not null default '';
alter table plants add column if not exists care_note text not null default '';

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

create table if not exists plant_sensor_configs (
  plant_id uuid primary key references plants(id) on delete cascade,
  soil_sensor_enabled boolean not null default false,
  soil_sensor_device_id text,
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

create table if not exists plant_photos (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id) on delete cascade,
  image_url text not null,
  note text not null default '',
  captured_at date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists watering_logs_plant_date_idx
  on watering_logs (plant_name, watered_at desc);

create index if not exists sensor_readings_location_recorded_idx
  on sensor_readings (location, recorded_at desc);

create index if not exists pump_commands_device_status_idx
  on pump_commands (pump_device_id, status, requested_at desc);

create index if not exists plant_photos_plant_captured_idx
  on plant_photos (plant_id, captured_at desc, created_at desc);
