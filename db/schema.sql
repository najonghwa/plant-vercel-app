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
  -- 토양센서를 달지 않은 기기도 있으므로 nullable이다.
  -- null은 "측정 안 함"이고, 0은 "완전히 말랐음"이라 의미가 전혀 다르다.
  soil_moisture_pct numeric(5, 2),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table sensor_readings
  add column if not exists soil_moisture_pct numeric(5, 2);

alter table sensor_readings
  alter column soil_moisture_pct drop not null;

alter table sensor_readings
  alter column soil_moisture_pct drop default;

create table if not exists plant_automation_configs (
  plant_id uuid primary key references plants(id) on delete cascade,
  enabled boolean not null default false,
  pump_device_id text not null default 'pump-balcony-01',
  moisture_min_pct numeric(5, 2) not null default 30,
  watering_seconds integer not null default 5 check (watering_seconds between 1 and 15),
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
  watering_seconds integer not null check (watering_seconds between 1 and 15),
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'cancelled', 'failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists day_memos (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists day_memos_date_idx
  on day_memos (entry_date desc, created_at desc);

-- 사진은 별도 스토리지 없이 data URL 문자열로 보관한다.
-- image_url은 원본, thumb_url은 목록용 축소본이며 목록 조회에는 thumb_url만 쓴다.
create table if not exists plant_photos (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id) on delete cascade,
  image_url text not null,
  thumb_url text not null default '',
  note text not null default '',
  captured_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table plant_photos add column if not exists thumb_url text not null default '';

create index if not exists watering_logs_plant_date_idx
  on watering_logs (plant_name, watered_at desc);

create index if not exists sensor_readings_location_recorded_idx
  on sensor_readings (location, recorded_at desc);

create index if not exists pump_commands_device_status_idx
  on pump_commands (pump_device_id, status, requested_at desc);

create index if not exists plant_photos_plant_captured_idx
  on plant_photos (plant_id, captured_at desc, created_at desc);

-- 펌프 하드웨어가 실제로 허용하는 상한이 15초라, 그보다 큰 값은 설정해도
-- 기기에서 잘려 나간다. 기존 DB의 30초 제약도 15초로 맞춘다.
update plant_automation_configs set watering_seconds = 15 where watering_seconds > 15;
update pump_commands set watering_seconds = 15 where watering_seconds > 15;

alter table plant_automation_configs drop constraint if exists plant_automation_configs_watering_seconds_check;
alter table plant_automation_configs add constraint plant_automation_configs_watering_seconds_check
  check (watering_seconds between 1 and 15);

alter table pump_commands drop constraint if exists pump_commands_watering_seconds_check;
alter table pump_commands add constraint pump_commands_watering_seconds_check
  check (watering_seconds between 1 and 15);

-- 기기당 처리 중인 명령은 하나뿐이어야 한다. 코드로만 검사하면 동시 요청 두 건이
-- 같은 순간에 통과해 연속 급수가 나간다.
-- 이미 쌓여 있는 미처리 명령은 가장 최근 1건만 남기고 정리해야 인덱스가 만들어진다.
update pump_commands
set status = 'cancelled', completed_at = now()
where status in ('pending', 'running')
  and id not in (
    select distinct on (pump_device_id) id
    from pump_commands
    where status in ('pending', 'running')
    order by pump_device_id, requested_at desc
  );

create unique index if not exists pump_commands_one_open_per_device
  on pump_commands (pump_device_id)
  where status in ('pending', 'running');
