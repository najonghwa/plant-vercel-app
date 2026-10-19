import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { ensurePlantPhotosTable } from "@/lib/photoTable";
import type { PlantPhoto } from "@/lib/types";
import {
  DATE_RE,
  MAX_PHOTOS_PER_PLANT,
  MAX_PHOTOS_TOTAL,
  PHOTO_RETURNING,
  checkImage,
  thumbUrlSql,
} from "@/lib/photoRules";

/**
 * 기록. 날짜 + 메모 + (선택) 사진 한 장으로 이뤄진다.
 * 사진 없이 메모만 남길 수도 있고, 특정 식물이 아닌 전체 사진도 남길 수 있다
 * (plant_id가 null이면 "특정 식물 아님").
 *
 * 테이블 이름이 plant_photos인 것은 사진 전용으로 먼저 만들어진 흔적이다.
 * 저장 구조는 그대로 두고 의미만 넓혔다.
 *
 * 사진은 별도 스토리지 없이 data URL 문자열로 Postgres에 넣는다.
 * 목록 응답에는 사진을 싣지 않고 썸네일 주소(/api/plant-photos/[id]/thumb)만 준다.
 * 크게 볼 사진은 /api/plant-photos/[id]에서 개별로 가져간다.
 */
/** 목록은 최신부터 이만큼만 내려준다. */
const LIST_LIMIT = 120;

export async function GET(request: Request) {
  await ensurePlantPhotosTable();

  // 식물 하나의 기록만 볼 때는 전체 목록의 상한에 잘리지 않도록 따로 조회한다.
  // plant_id=none 은 "특정 식물 아님" 기록만.
  const raw = new URL(request.url).searchParams.get("plant_id");
  const onlyUnassigned = raw === "none";
  const plantId = raw && !onlyUnassigned ? raw : null;
  const filtered = Boolean(raw);

  // image_url(원본)은 일부러 뺀다. 목록에 다 실으면 응답이 수십 MB가 된다.
  const photos = await query<PlantPhoto>(
    `select
       ph.id,
       ph.plant_id,
       p.name as plant_name,
       ${thumbUrlSql("ph")} as thumb_url,
       ph.image_url is not null as has_image,
       ph.note,
       ph.captured_at::text,
       ph.created_at
     from plant_photos ph
     left join plants p on p.id = ph.plant_id
     where ($1::uuid is null or ph.plant_id = $1::uuid)
       and (not $2::boolean or ph.plant_id is null)
     order by ph.captured_at desc, ph.created_at desc
     limit $3`,
    [plantId, onlyUnassigned, filtered ? 500 : LIST_LIMIT],
  );

  if (filtered) return NextResponse.json({ photos });

  // 전체 목록일 때만 식물별 건수와 사진이 차지하는 용량을 같이 준다.
  // 건수는 기록 탭의 식물 고르기 칸에, 용량은 "얼마나 더 올릴 수 있나"에 쓴다.
  // 용량은 표 크기로 잰다. 사진 글자 길이를 다 더하면 원본을 전부 읽어 느려진다.
  const counts = await query<{ plant_id: string | null; n: number }>(
    "select plant_id, count(*)::int as n from plant_photos group by plant_id",
  );
  let stats: { photos: number; limit: number; bytes: number | null; db_bytes: number | null } = {
    photos: 0,
    limit: MAX_PHOTOS_TOTAL,
    bytes: null,
    db_bytes: null,
  };
  try {
    const row = await queryOne<{ photos: number; bytes: string; db_bytes: string }>(
      `select
         (select count(*) from plant_photos where image_url is not null)::int as photos,
         pg_total_relation_size('plant_photos')::text as bytes,
         pg_database_size(current_database())::text as db_bytes`,
    );
    if (row) stats = { photos: row.photos, limit: MAX_PHOTOS_TOTAL, bytes: Number(row.bytes), db_bytes: Number(row.db_bytes) };
  } catch {
    // 크기 함수를 못 쓰는 DB여도 목록은 보여야 한다.
    const row = await queryOne<{ photos: number }>(
      "select count(*)::int as photos from plant_photos where image_url is not null",
    );
    stats.photos = row?.photos ?? 0;
  }

  return NextResponse.json({ photos, counts, stats });
}

export async function POST(request: Request) {
  await ensurePlantPhotosTable();

  const body = await request.json();
  const plantId = String(body.plant_id ?? "").trim();
  const imageUrl = String(body.image_url ?? "").trim();
  const thumbUrl = String(body.thumb_url ?? "").trim();
  const capturedAt = String(body.captured_at ?? "").trim();

  const note = String(body.note ?? "").trim();

  if (!capturedAt) {
    return NextResponse.json({ error: "날짜가 필요합니다." }, { status: 400 });
  }

  // 사진은 선택이다. 대신 사진도 메모도 없으면 남길 내용이 없다.
  if (!imageUrl && !note) {
    return NextResponse.json({ error: "메모를 쓰거나 사진을 넣어주세요." }, { status: 400 });
  }

  // thumb_url 컬럼은 not null이라 사진 없는 기록도 빈 문자열로 넣어야 한다.
  // null을 넣으면 메모만 남기는 저장이 통째로 500으로 떨어진다.
  let storedThumb = "";

  if (imageUrl) {
    const checked = checkImage(imageUrl, thumbUrl);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    storedThumb = checked.thumb;
  }

  if (!DATE_RE.test(capturedAt)) {
    return NextResponse.json({ error: "촬영일 형식이 올바르지 않습니다." }, { status: 400 });
  }

  // 식물은 선택이다. 지정했다면 실제로 있는 식물이어야 한다.
  if (plantId) {
    const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [plantId]);
    if (!plant) {
      return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
    }
  }

  // 사진이 없는 메모는 용량 부담이 거의 없으므로 장수 상한 대상에서 뺀다.
  const counts = imageUrl ? await queryOne<{ per_plant: number; total: number }>(
    `select
       count(*) filter (where plant_id = $1::uuid)::int as per_plant,
       count(*)::int as total
     from plant_photos
     where image_url is not null`,
    // 식물을 안 고른 기록은 빈 문자열이 uuid로 캐스팅되며 터진다. null로 넘긴다.
    [plantId || null],
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
     returning ${PHOTO_RETURNING}`,
    [plantId || null, imageUrl || null, storedThumb, note.slice(0, 500), capturedAt],
  );

  return NextResponse.json({ photo: photos[0] }, { status: 201 });
}
