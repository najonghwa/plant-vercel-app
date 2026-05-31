import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const enabled = Boolean(body.soil_sensor_enabled);
  const sensorDeviceId = String(body.soil_sensor_device_id ?? "").trim();

  const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [id]);
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  await query(
    `create table if not exists plant_sensor_configs (
       plant_id uuid primary key references plants(id) on delete cascade,
       soil_sensor_enabled boolean not null default false,
       soil_sensor_device_id text,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )`,
  );

  if (enabled && sensorDeviceId) {
    await query(
      `update plant_sensor_configs
       set soil_sensor_enabled = false, updated_at = now()
       where soil_sensor_device_id = $1`,
      [sensorDeviceId],
    );
  }

  const configs = await query(
    `insert into plant_sensor_configs (plant_id, soil_sensor_enabled, soil_sensor_device_id)
     values ($1, $2, $3)
     on conflict (plant_id) do update set
       soil_sensor_enabled = excluded.soil_sensor_enabled,
       soil_sensor_device_id = excluded.soil_sensor_device_id,
       updated_at = now()
     returning soil_sensor_enabled, soil_sensor_device_id`,
    [id, enabled, sensorDeviceId || null],
  );

  return NextResponse.json({ config: configs[0] });
}
