import { NextResponse } from "next/server";
import { query } from "@/lib/db";

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
