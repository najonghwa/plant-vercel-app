import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { WateringLog } from "@/lib/types";

export async function GET() {
  const logs = await query<WateringLog>(
    `select id, plant_id, plant_name, watered_at::text, memo, source, created_at
     from watering_logs
     order by watered_at desc, created_at desc`,
  );

  return NextResponse.json({ logs });
}

export async function POST(request: Request) {
  const body = await request.json();
  const plantNames = Array.isArray(body.plant_names)
    ? body.plant_names.map((name: unknown) => String(name).trim()).filter(Boolean)
    : [String(body.plant_name ?? body.plant ?? "").trim()].filter(Boolean);
  const wateredAt = String(body.watered_at ?? body.date ?? "").trim();

  if (!plantNames.length || !wateredAt) {
    return NextResponse.json({ error: "plant_names와 watered_at이 필요합니다." }, { status: 400 });
  }

  const plants = await query<{ id: string; name: string }>(
    "select id, name from plants where name = any($1::text[])",
    [plantNames],
  );

  const foundNames = new Set(plants.map((plant) => plant.name));
  const missingNames = plantNames.filter((name) => !foundNames.has(name));

  if (missingNames.length) {
    return NextResponse.json({ error: `등록되지 않은 식물입니다: ${missingNames.join(", ")}` }, { status: 404 });
  }

  const createdLogs: WateringLog[] = [];
  for (const plantName of plantNames) {
    const plant = plants.find((item) => item.name === plantName);
    if (!plant) continue;

    const logs = await query<WateringLog>(
      `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
       values ($1, $2, $3::date, $4, 'manual')
       returning id, plant_id, plant_name, watered_at::text, memo, source, created_at`,
      [plant.id, plant.name, wateredAt, String(body.memo ?? "")],
    );
    createdLogs.push(logs[0]);
  }

  return NextResponse.json({ log: createdLogs[0], logs: createdLogs }, { status: 201 });
}
