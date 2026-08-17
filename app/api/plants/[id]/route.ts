import { NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";

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

  await withTransaction(async (tx) => {
    // pump_commands의 plant_id는 on delete set null이라, 식물을 지워도 대기 중인
    // 명령은 그대로 남아 기기가 가져가서 실제로 물을 준다. 먼저 취소한다.
    await tx(
      `update pump_commands
       set status = 'cancelled', completed_at = now()
       where plant_id = $1 and status in ('pending', 'running')`,
      [id],
    );

    // 나머지 설정/사진은 FK(on delete cascade)로 함께 정리된다.
    await tx("delete from plants where id = $1", [id]);
  });

  return NextResponse.json({ deleted: plant });
}
