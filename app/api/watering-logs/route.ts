import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
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
  const plantName = String(body.plant_name ?? body.plant ?? "").trim();
  const wateredAt = String(body.watered_at ?? body.date ?? "").trim();

  if (!plantName || !wateredAt) {
    return NextResponse.json({ error: "plant_name과 watered_at이 필요합니다." }, { status: 400 });
  }

  const plant = await queryOne<{ id: string; name: string }>(
    "select id, name from plants where name = $1",
    [plantName],
  );

  if (!plant) {
    return NextResponse.json({ error: "등록되지 않은 식물입니다." }, { status: 404 });
  }

  const logs = await query<WateringLog>(
    `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
     values ($1, $2, $3::date, $4, 'manual')
     returning id, plant_id, plant_name, watered_at::text, memo, source, created_at`,
    [plant.id, plant.name, wateredAt, String(body.memo ?? "")],
  );

  return NextResponse.json({ log: logs[0] }, { status: 201 });
}
