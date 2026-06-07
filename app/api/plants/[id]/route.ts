import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const plant = await queryOne<{ id: string; name: string }>(
    "select id, name from plants where id = $1",
    [id],
  );
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 연결된 설정/명령은 FK(on delete cascade / set null)로 자동 정리됨
  await query("delete from plants where id = $1", [id]);

  return NextResponse.json({ deleted: plant });
}
