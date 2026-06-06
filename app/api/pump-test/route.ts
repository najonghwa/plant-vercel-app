import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { PumpCommand } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pumpDeviceId = url.searchParams.get("pump_device_id") ?? "pump-balcony-01";
  const plantName = url.searchParams.get("plant_name") ?? "pump-test";
  const location = url.searchParams.get("location") ?? "\uBCA0\uB780\uB2E4";
  const seconds = Math.max(1, Math.min(20, Number(url.searchParams.get("seconds") ?? 5)));

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
