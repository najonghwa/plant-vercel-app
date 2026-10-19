import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import {
  DATE_RE,
  MAX_PHOTOS_PER_PLANT,
  MAX_PHOTOS_TOTAL,
  PHOTO_RETURNING,
  checkImage,
} from "@/lib/photoRules";
import type { PlantPhoto } from "@/lib/types";

type Params = {
  params: Promise<{ id: string }>;
};

/** 목록에는 썸네일만 실려 있으므로, 크게 볼 때 원본을 이 경로로 따로 가져간다. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const rows = await query<{ image_url: string }>(
    "select image_url from plant_photos where id = $1",
    [id],
  );

  if (!rows.length) {
    return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ image_url: rows[0].image_url });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const deleted = await query<{ id: string }>(
    "delete from plant_photos where id = $1 returning id",
    [id],
  );

  if (!deleted.length) {
    return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ deleted: deleted[0] });
}

/**
 * 기록 고치기. 잘못 올린 기록을 지우고 다시 올리지 않아도 되게 한다.
 * 보낸 칸만 바꾼다 — plant_id(null이면 "특정 식물 아님"), note, captured_at,
 * 사진은 image_url+thumb_url로 바꾸거나 remove_image로 뺀다.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const parsed: unknown = await request.json().catch(() => null);
  // null·숫자 같은 본문이면 `in` 검사에서 터진다. 빈 객체로 본다.
  const body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  const current = await queryOne<{ plant_id: string | null; has_image: boolean; note: string; captured_at: string }>(
    "select plant_id, image_url is not null as has_image, note, captured_at::text from plant_photos where id = $1",
    [id],
  );
  if (!current) {
    return NextResponse.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
  }

  let plantId = current.plant_id;
  if ("plant_id" in body) {
    plantId = body.plant_id ? String(body.plant_id).trim() : null;
    if (plantId) {
      const plant = await queryOne<{ id: string }>("select id from plants where id = $1", [plantId]);
      if (!plant) return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
    }
  }

  const note = "note" in body ? String(body.note ?? "").trim().slice(0, 500) : current.note;

  let capturedAt = current.captured_at;
  if ("captured_at" in body) {
    capturedAt = String(body.captured_at ?? "").trim();
    if (!DATE_RE.test(capturedAt)) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
  }

  // 사진: 그대로 / 바꾸기 / 빼기
  let image: { url: string | null; thumb: string } | null = null;
  if (body.remove_image) {
    image = { url: null, thumb: "" };
  } else if (body.image_url) {
    const checked = checkImage(String(body.image_url).trim(), String(body.thumb_url ?? "").trim());
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    image = { url: String(body.image_url).trim(), thumb: checked.thumb };
  }
  const willHaveImage = image ? image.url !== null : current.has_image;

  if (!willHaveImage && !note) {
    return NextResponse.json({ error: "메모를 쓰거나 사진을 넣어주세요." }, { status: 400 });
  }

  // 사진이 새로 생기거나 다른 식물로 옮겨 가면 그쪽 장수 상한을 다시 본다.
  if (willHaveImage && (!current.has_image || plantId !== current.plant_id)) {
    const counts = await queryOne<{ per_plant: number; total: number }>(
      `select
         count(*) filter (where plant_id = $1::uuid)::int as per_plant,
         count(*)::int as total
       from plant_photos
       where image_url is not null and id <> $2`,
      [plantId, id],
    );
    if (plantId && (counts?.per_plant ?? 0) >= MAX_PHOTOS_PER_PLANT) {
      return NextResponse.json(
        { error: `한 식물에는 사진을 ${MAX_PHOTOS_PER_PLANT}장까지 보관할 수 있습니다.` },
        { status: 409 },
      );
    }
    if (!current.has_image && (counts?.total ?? 0) >= MAX_PHOTOS_TOTAL) {
      return NextResponse.json({ error: `사진은 전체 ${MAX_PHOTOS_TOTAL}장까지 보관할 수 있습니다.` }, { status: 409 });
    }
  }

  const rows = image
    ? await query<PlantPhoto>(
        `update plant_photos
         set plant_id = $2, note = $3, captured_at = $4::date, image_url = $5, thumb_url = $6
         where id = $1
         returning ${PHOTO_RETURNING}`,
        [id, plantId, note, capturedAt, image.url, image.thumb],
      )
    : await query<PlantPhoto>(
        `update plant_photos
         set plant_id = $2, note = $3, captured_at = $4::date
         where id = $1
         returning ${PHOTO_RETURNING}`,
        [id, plantId, note, capturedAt],
      );

  return NextResponse.json({ photo: rows[0] });
}
