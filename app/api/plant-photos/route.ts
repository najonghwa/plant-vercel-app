import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { PlantPhoto } from "@/lib/types";

/**
 * 식물별 기록(관찰 일지). 날짜 + 메모 + (선택) 사진 한 장으로 이뤄진다.
 * 사진 없이 메모만 남길 수도 있다.
 *
 * 테이블 이름이 plant_photos인 것은 사진 전용으로 먼저 만들어진 흔적이다.
 * 저장 구조는 그대로 두고 의미만 넓혔다.
 *
 * 사진은 별도 스토리지 없이 data URL 문자열로 Postgres에 넣는다.
 * 대신 목록에서 원본을 다 내려받으면 느려지므로 작은 썸네일을 따로 저장하고,
 * 목록 응답에는 썸네일만 싣는다. 원본은 /api/plant-photos/[id]에서 개별로 가져간다.
 */
const MAX_IMAGE_CHARS = 3_000_000; // data URL 기준 약 2.2MB
const MAX_THUMB_CHARS = 400_000;
/** 식물 한 종당, 그리고 전체 보관 장수 상한. DB가 사진으로 가득 차는 것을 막는다. */
const MAX_PHOTOS_PER_PLANT = 200;
const MAX_PHOTOS_TOTAL = 2000;
/** 목록은 최신부터 이만큼만 내려준다. */
const LIST_LIMIT = 120;

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
       image_url text,
       note text not null default '',
       captured_at date not null default current_date,
       created_at timestamptz not null default now()
     )`,
  );

  await query("alter table plant_photos add column if not exists thumb_url text not null default ''");
  // 사진 없이 메모만 남기는 기록을 허용한다.
  await query("alter table plant_photos alter column image_url drop not null");

  await query(
    `create index if not exists plant_photos_plant_captured_idx
     on plant_photos (plant_id, captured_at desc, created_at desc)`,
  );
}

export async function GET(request: Request) {
  await ensurePlantPhotosTable();

  // 식물 하나의 기록만 볼 때는 전체 목록의 상한에 잘리지 않도록 따로 조회한다.
  const plantId = new URL(request.url).searchParams.get("plant_id");

  // image_url(원본)은 일부러 뺀다. 목록에 다 실으면 응답이 수십 MB가 된다.
  const photos = await query<PlantPhoto>(
    `select
       ph.id,
       ph.plant_id,
       p.name as plant_name,
       nullif(ph.thumb_url, '') as thumb_url,
       ph.image_url is not null as has_image,
       ph.note,
       ph.captured_at::text,
       ph.created_at
     from plant_photos ph
     join plants p on p.id = ph.plant_id
     where $1::uuid is null or ph.plant_id = $1::uuid
     order by ph.captured_at desc, ph.created_at desc
     limit $2`,
    [plantId, plantId ? 500 : LIST_LIMIT],
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

  const note = String(body.note ?? "").trim();

  if (!plantId || !capturedAt) {
    return NextResponse.json({ error: "식물과 날짜가 필요합니다." }, { status: 400 });
  }

  // 사진은 선택이다. 대신 사진도 메모도 없으면 남길 내용이 없다.
  if (!imageUrl && !note) {
    return NextResponse.json({ error: "메모를 쓰거나 사진을 넣어주세요." }, { status: 400 });
  }

  let storedThumb: string | null = null;

  if (imageUrl) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(imageUrl)) {
      return NextResponse.json({ error: "이미지 형식이 올바르지 않습니다." }, { status: 400 });
    }

    // 썸네일을 비워 보내면 원본이 썸네일 자리에 들어간다. 실제로 저장될 값으로 검사해야
    // 썸네일 용량 제한이 우회되지 않는다.
    storedThumb = thumbUrl || imageUrl;

    if (imageUrl.length > MAX_IMAGE_CHARS || storedThumb.length > MAX_THUMB_CHARS) {
      return NextResponse.json(
        { error: "사진 용량이 너무 큽니다. 더 작은 사진으로 다시 시도해주세요." },
        { status: 413 },
      );
    }

    if (!/^data:image\/(jpeg|png|webp);base64,/.test(storedThumb)) {
      return NextResponse.json({ error: "썸네일 형식이 올바르지 않습니다." }, { status: 400 });
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) {
    return NextResponse.json({ error: "촬영일 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [plantId]);
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 사진이 없는 메모는 용량 부담이 거의 없으므로 장수 상한 대상에서 뺀다.
  const counts = imageUrl ? await queryOne<{ per_plant: number; total: number }>(
    `select
       count(*) filter (where plant_id = $1)::int as per_plant,
       count(*)::int as total
     from plant_photos
     where image_url is not null`,
    [plantId],
  ) : null;
  if ((counts?.per_plant ?? 0) >= MAX_PHOTOS_PER_PLANT) {
    return NextResponse.json(
      { error: `한 식물에는 사진을 ${MAX_PHOTOS_PER_PLANT}장까지 보관할 수 있습니다.` },
      { status: 409 },
    );
  }
  if ((counts?.total ?? 0) >= MAX_PHOTOS_TOTAL) {
    return NextResponse.json(
      { error: `사진은 전체 ${MAX_PHOTOS_TOTAL}장까지 보관할 수 있습니다.` },
      { status: 409 },
    );
  }

  // 등록 직후 화면에 바로 그려야 하므로 반환값에도 원본이 아닌 썸네일만 싣는다.
  const photos = await query<PlantPhoto>(
    `insert into plant_photos (plant_id, image_url, thumb_url, note, captured_at)
     values ($1, $2, coalesce($3, ''), $4, $5::date)
     returning
       id,
       plant_id,
       (select name from plants where id = $1) as plant_name,
       nullif(thumb_url, '') as thumb_url,
       image_url is not null as has_image,
       note,
       captured_at::text,
       created_at`,
    [plantId, imageUrl || null, storedThumb, note.slice(0, 500), capturedAt],
  );

  return NextResponse.json({ photo: photos[0] }, { status: 201 });
}
