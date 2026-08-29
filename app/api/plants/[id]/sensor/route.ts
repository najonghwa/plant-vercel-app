import { NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";

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

  // 다른 식물의 센서를 끄는 것과 이 식물에 붙이는 것은 한 덩어리여야 한다.
  // 따로 실행하면 앞만 성공했을 때 어느 식물에도 붙어 있지 않은 센서가 남는다.
  const configs = await withTransaction(async (tx) => {
    await tx(
      `create table if not exists plant_sensor_configs (
         plant_id uuid primary key references plants(id) on delete cascade,
         soil_sensor_enabled boolean not null default false,
         soil_sensor_device_id text,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       )`,
    );

    if (enabled && sensorDeviceId) {
      await tx(
        `update plant_sensor_configs
         set soil_sensor_enabled = false, updated_at = now()
         where soil_sensor_device_id = $1`,
        [sensorDeviceId],
      );
    }

    return tx(
      `insert into plant_sensor_configs (plant_id, soil_sensor_enabled, soil_sensor_device_id)
       values ($1, $2, $3)
       on conflict (plant_id) do update set
         soil_sensor_enabled = excluded.soil_sensor_enabled,
         soil_sensor_device_id = excluded.soil_sensor_device_id,
         updated_at = now()
       returning soil_sensor_enabled, soil_sensor_device_id`,
      [id, enabled, sensorDeviceId || null],
    );
  });

  return NextResponse.json({ config: configs[0] });
}
