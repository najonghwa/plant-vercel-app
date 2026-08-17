import { NextResponse } from "next/server";
import { query, queryOne, withTransaction } from "@/lib/db";
import type { PumpCommand } from "@/lib/types";

/** 기기가 명령을 가져간 뒤 이 시간 안에 결과를 알리지 않으면 실패로 보고 회수한다. */
const RUNNING_TIMEOUT_MINUTES = 10;

/** 대시보드의 "펌프 테스트"로 만든 명령. 급수 이력이나 쿨다운에 반영하지 않는다. */
const MANUAL_REASON_PREFIX = "manual";

function isAuthorized(request: Request) {
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) return false;

  const url = new URL(request.url);
  const providedToken = request.headers.get("x-device-token") || url.searchParams.get("token");
  return providedToken === expectedToken;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 401 });
  }

  const url = new URL(request.url);
  const deviceId = url.searchParams.get("device_id") ?? "pump-balcony-01";

  // 기기가 명령을 받아간 뒤 껐거나 Wi-Fi가 끊기면 그 명령이 running으로 영영 남는다.
  // 자동급수는 미완료 명령이 있으면 새 명령을 만들지 않으므로, 회수하지 않으면
  // 해당 식물의 자동급수가 영구히 멈춘다.
  await query(
    `update pump_commands
     set status = 'failed', completed_at = now()
     where pump_device_id = $1
       and status = 'running'
       and requested_at < now() - make_interval(mins => $2::int)`,
    [deviceId, RUNNING_TIMEOUT_MINUTES],
  );

  const commands = await query<PumpCommand>(
    `select
       id,
       plant_id,
       plant_name,
       location,
       pump_device_id,
       watering_seconds,
       reason,
       status,
       requested_at,
       completed_at
     from pump_commands
     where pump_device_id = $1 and status = 'pending'
     order by requested_at asc
     limit 5`,
    [deviceId],
  );

  return NextResponse.json({ commands });
}

export async function POST(request: Request) {
  const body = await request.json();
  const plantId = String(body.plant_id ?? "");
  const plantName = String(body.plant_name ?? "");
  const location = String(body.location ?? "\uBCA0\uB780\uB2E4");
  const pumpDeviceId = String(body.pump_device_id ?? "pump-balcony-01");
  // 펌웨어가 실제로 허용하는 상한(15초)에 맞춘다. 이보다 크게 보내도 잘려서 나간다.
  const wateringSeconds = Math.max(1, Math.min(15, Number(body.watering_seconds ?? 5)));

  if (!plantId || !plantName) {
    return NextResponse.json({ error: "plant_id and plant_name are required." }, { status: 400 });
  }

  if (!["거실", "베란다"].includes(location)) {
    return NextResponse.json({ error: "location은 거실 또는 베란다만 가능합니다." }, { status: 400 });
  }

  const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [plantId]);
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 아직 처리되지 않은 명령이 있는데 또 넣으면 기기가 연달아 물을 준다.
  const open = await queryOne<{ id: string }>(
    `select id from pump_commands
     where pump_device_id = $1 and status in ('pending', 'running')
     limit 1`,
    [pumpDeviceId],
  );
  if (open) {
    return NextResponse.json(
      { error: "아직 처리되지 않은 펌프 명령이 있습니다. 완료된 뒤 다시 시도해주세요." },
      { status: 409 },
    );
  }

  const commands = await query<PumpCommand>(
    `insert into pump_commands (plant_id, plant_name, location, pump_device_id, watering_seconds, reason)
     values ($1, $2, $3, $4, $5, 'manual dashboard pump test')
     returning
       id,
       plant_id,
       plant_name,
       location,
       pump_device_id,
       watering_seconds,
       reason,
       status,
       requested_at,
       completed_at`,
    [plantId, plantName, location, pumpDeviceId, wateringSeconds],
  );

  return NextResponse.json({ command: commands[0] }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 401 });
  }

  const body = await request.json();
  const commandId = String(body.command_id ?? "");
  const status = String(body.status ?? "completed");

  if (!commandId || !["running", "completed", "cancelled", "failed"].includes(status)) {
    return NextResponse.json({ error: "command_id and a valid status are required." }, { status: 400 });
  }

  // 명령 상태 갱신과 그에 딸린 급수 이력/쿨다운은 한 덩어리다.
  // 따로 실행하면 중간에 실패했을 때 "물은 줬는데 기록이 없는" 상태가 남는다.
  const command = await withTransaction(async (tx) => {
    const updated = await tx<PumpCommand>(
      `update pump_commands c
       set
         status = $2,
         completed_at = case when $2 in ('completed', 'cancelled', 'failed') then now() else completed_at end
       where c.id = $1
         and c.status <> 'completed'
       returning
         id,
         plant_id,
         plant_name,
         location,
         pump_device_id,
         watering_seconds,
         reason,
         status,
         requested_at,
         completed_at`,
      [commandId, status],
    );

    const row = updated[0];
    if (!row || row.status !== "completed" || !row.plant_id) return row ?? null;

    // 대시보드에서 누른 펌프 테스트까지 자동급수로 기록하면, 테스트 한 번에
    // 쿨다운이 걸려 정작 필요한 자동급수가 막힌다.
    if ((row.reason ?? "").startsWith(MANUAL_REASON_PREFIX)) return row;

    await tx(
      `update plant_automation_configs
       set last_run_at = now(), updated_at = now()
       where plant_id = $1`,
      [row.plant_id],
    );

    // DB 세션 타임존이 UTC라 current_date를 쓰면 한국 시간 오전 9시 이전 급수가
    // 전날 기록으로 남는다.
    await tx(
      `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
       values ($1, $2, (now() at time zone 'Asia/Seoul')::date, $3, 'automation')`,
      [row.plant_id, row.plant_name, `auto watering ${row.watering_seconds}s`],
    );

    return row;
  });

  return NextResponse.json({ command: command ?? null });
}
