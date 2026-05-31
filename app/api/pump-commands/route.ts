import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { PumpCommand } from "@/lib/types";

function isAuthorized(request: Request) {
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) return false;

  const url = new URL(request.url);
  const providedToken = request.headers.get("x-device-token") || url.searchParams.get("token");
  return providedToken === expectedToken;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "인증 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  const url = new URL(request.url);
  const deviceId = url.searchParams.get("device_id") ?? "pump-balcony-01";

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

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "인증 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  const body = await request.json();
  const commandId = String(body.command_id ?? "");
  const status = String(body.status ?? "completed");

  if (!commandId || !["running", "completed", "cancelled", "failed"].includes(status)) {
    return NextResponse.json({ error: "command_id와 유효한 status가 필요합니다." }, { status: 400 });
  }

  const commands = await query<PumpCommand>(
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

  if (commands[0]?.status === "completed" && commands[0].plant_id) {
    await query(
      `update plant_automation_configs
       set last_run_at = now(), updated_at = now()
       where plant_id = $1`,
      [commands[0].plant_id],
    );

    await query(
      `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
       values ($1, $2, current_date, $3, 'automation')`,
      [commands[0].plant_id, commands[0].plant_name, `자동급수 ${commands[0].watering_seconds}초`],
    );
  }

  return NextResponse.json({ command: commands[0] ?? null });
}
