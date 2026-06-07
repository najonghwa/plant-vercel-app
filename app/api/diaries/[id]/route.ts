import { NextResponse } from "next/server";
import { query } from "@/lib/db";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const deleted = await query<{ id: string }>(
    "delete from plant_diaries where id = $1 returning id",
    [id],
  );

  if (!deleted.length) {
    return NextResponse.json({ error: "일기를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ deleted: deleted[0] });
}
