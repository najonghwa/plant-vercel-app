import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { PumpCommand } from "@/lib/types";

const ALLOWED_LOCATIONS = ["거실", "베란다"];

/**
 * 펌웨어 점검용 수동 명령. 실제로 물이 나가는 동작이라 기기 토큰을 요구한다.
 * 예전에는 토큰 없는 GET이어서 주소만 알면 누구나, 심지어 브라우저 프리페치만으로도
 * 베란다 펌프를 돌릴 수 있었다.
 */
function isAuthorized(request: Request) {
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) return false;

  const url = new URL(request.url);
  const providedToken = request.headers.get("x-device-token") || url.searchParams.get("token");
  return providedToken === expectedToken;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 401 });
  }

  const url = new URL(request.url);
  const pumpDeviceId = url.searchParams.get("pump_device_id") ?? "pump-balcony-01";
  const plantName = url.searchParams.get("plant_name") ?? "pump-test";
  const location = url.searchParams.get("location") ?? "베란다";
  // 펌웨어가 15초에서 자르므로 그 이상은 받아도 의미가 없다.
  const seconds = Math.max(1, Math.min(15, Number(url.searchParams.get("seconds") ?? 5)));

  if (!ALLOWED_LOCATIONS.includes(location)) {
    return NextResponse.json({ error: "location은 거실 또는 베란다만 가능합니다." }, { status: 400 });
  }

  // 처리되지 않은 명령이 남아 있는데 또 넣으면 기기가 연달아 물을 준다.
  const open = await queryOne<{ id: string }>(
    `select id from pump_commands
     where pump_device_id = $1 and status in ('pending', 'running')
     limit 1`,
    [pumpDeviceId],
  );
  if (open) {
    return NextResponse.json(
      { error: "아직 처리되지 않은 펌프 명령이 있습니다." },
      { status: 409 },
    );
  }

  const plants = await query<{ id: string }>(
    `select id from plants where name = $1 order by created_at desc limit 1`,
    [plantName],
  );

  const commands = await query<PumpCommand>(
    `insert into pump_commands (plant_id, plant_name, location, pump_device_id, watering_seconds, reason)
     values ($1, $2, $3, $4, $5, 'manual browser pump test')
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
    [plants[0]?.id ?? null, plantName, location, pumpDeviceId, seconds],
  );

  return NextResponse.json({
    ok: true,
    message: `${pumpDeviceId} pump test queued for ${seconds} seconds.`,
    command: commands[0],
  });
}
