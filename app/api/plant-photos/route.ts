import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { PlantPhoto } from "@/lib/types";

/**
 * 사진은 별도 스토리지 없이 data URL 문자열로 Postgres에 넣는다.
 * 대신 목록에서 원본을 다 내려받으면 느려지므로 작은 썸네일을 따로 저장하고,
 * 목록 응답에는 썸네일만 싣는다. 원본은 /api/plant-photos/[id]에서 개별로 가져간다.
 */
const MAX_IMAGE_CHARS = 3_000_000; // data URL 기준 약 2.2MB
const MAX_THUMB_CHARS = 400_000;

// 요청마다 DDL을 돌리지 않도록 프로세스당 한 번만 실행한다.
let tableReady: Promise<void> | null = null;

function ensurePlantPhotosTable() {
  if (!tableReady) {
    tableReady = migratePlantPhotos().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

async function migratePlantPhotos() {
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

  await query("alter table plant_photos add column if not exists thumb_url text not null default ''");

  await query(
    `create index if not exists plant_photos_plant_captured_idx
     on plant_photos (plant_id, captured_at desc, created_at desc)`,
  );
}

export async function GET() {
  await ensurePlantPhotosTable();

  // image_url(원본)은 일부러 뺀다. 목록에 다 실으면 응답이 수십 MB가 된다.
  const photos = await query<PlantPhoto>(
    `select
       ph.id,
       ph.plant_id,
       p.name as plant_name,
       nullif(ph.thumb_url, '') as thumb_url,
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
  const thumbUrl = String(body.thumb_url ?? "").trim();
  const capturedAt = String(body.captured_at ?? "").trim();

  if (!plantId || !imageUrl || !capturedAt) {
    return NextResponse.json({ error: "식물, 사진, 촬영일이 모두 필요합니다." }, { status: 400 });
  }

  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imageUrl)) {
    return NextResponse.json({ error: "이미지 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (imageUrl.length > MAX_IMAGE_CHARS || thumbUrl.length > MAX_THUMB_CHARS) {
    return NextResponse.json(
      { error: "사진 용량이 너무 큽니다. 더 작은 사진으로 다시 시도해주세요." },
      { status: 413 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) {
    return NextResponse.json({ error: "촬영일 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [plantId]);
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 등록 직후 화면에 바로 그려야 하므로 반환값에도 원본이 아닌 썸네일만 싣는다.
  const photos = await query<PlantPhoto>(
    `insert into plant_photos (plant_id, image_url, thumb_url, note, captured_at)
     values ($1, $2, $3, $4, $5::date)
     returning
       id,
       plant_id,
       (select name from plants where id = $1) as plant_name,
       nullif(thumb_url, '') as thumb_url,
       note,
       captured_at::text,
       created_at`,
    [plantId, imageUrl, thumbUrl || imageUrl, String(body.note ?? "").slice(0, 500), capturedAt],
  );

  return NextResponse.json({ photo: photos[0] }, { status: 201 });
}
