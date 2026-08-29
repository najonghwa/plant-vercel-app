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
  const rawNames: unknown[] = Array.isArray(body.plant_names)
    ? body.plant_names
    : [body.plant_name ?? body.plant ?? ""];
  // 같은 식물을 두 번 넣으면 같은 날짜 기록이 중복 생성되므로 여기서 걸러낸다.
  const plantNames = Array.from(
    new Set(rawNames.map((name) => String(name ?? "").trim()).filter(Boolean)),
  );
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

  // 예전에는 for 루프로 한 건씩 넣어, 중간에 실패하면 일부만 저장된 채로 끝났다.
  // 한 문장으로 넣어 전부 저장되거나 전부 실패하게 한다.
  const orderedIds = plantNames.map((name) => plants.find((item) => item.name === name)!.id);

  const createdLogs = await query<WateringLog>(
    `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
     select input.id, input.name, $3::date, $4, 'manual'
     from unnest($1::uuid[], $2::text[]) as input(id, name)
     returning id, plant_id, plant_name, watered_at::text, memo, source, created_at`,
    [orderedIds, plantNames, wateredAt, String(body.memo ?? "")],
  );

  return NextResponse.json({ log: createdLogs[0], logs: createdLogs }, { status: 201 });
}
