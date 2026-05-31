import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { PlantPhoto } from "@/lib/types";

async function ensurePlantPhotosTable() {
  await query(
    `create table if not exists plant_photos (
       id uuid primary key default gen_random_uuid(),
       plant_id uuid not null references plants(id) on delete cascade,
       image_url text not null,
       note text not null default '',
       captured_at date not null default current_date,
       created_at timestamptz not null default now()
     )`,
  );

  await query(
    `create index if not exists plant_photos_plant_captured_idx
     on plant_photos (plant_id, captured_at desc, created_at desc)`,
  );
}

export async function GET() {
  await ensurePlantPhotosTable();

  const photos = await query<PlantPhoto>(
    `select
       ph.id,
       ph.plant_id,
       p.name as plant_name,
       ph.image_url,
       ph.note,
       ph.captured_at::text,
       ph.created_at
     from plant_photos ph
     join plants p on p.id = ph.plant_id
     order by ph.captured_at desc, ph.created_at desc`,
  );

  return NextResponse.json({ photos });
}

export async function POST(request: Request) {
  await ensurePlantPhotosTable();

  const body = await request.json();
  const plantId = String(body.plant_id ?? "").trim();
  const imageUrl = String(body.image_url ?? "").trim();
  const capturedAt = String(body.captured_at ?? "").trim();

  if (!plantId || !imageUrl || !capturedAt) {
    return NextResponse.json({ error: "plant_id, image_url, captured_at이 필요합니다." }, { status: 400 });
  }

  const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [plantId]);
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  const photos = await query<PlantPhoto>(
    `insert into plant_photos (plant_id, image_url, note, captured_at)
     values ($1, $2, $3, $4::date)
     returning
       id,
       plant_id,
       (select name from plants where id = $1) as plant_name,
       image_url,
       note,
       captured_at::text,
       created_at`,
    [plantId, imageUrl, String(body.note ?? ""), capturedAt],
  );

  return NextResponse.json({ photo: photos[0] }, { status: 201 });
}
