import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { ensureCommandTracking } from "@/lib/migrations";
import type { WateringLog } from "@/lib/types";

type Params = {
  params: Promise<{ id: string }>;
};

type DeletedLog = WateringLog & { pump_command_id: string | null };

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  await ensureCommandTracking();

  // 기록 삭제와 그에 딸린 자동급수 잠금 해제는 한 덩어리다.
  // 따로 실행하면 기록만 사라지고 쿨다운은 그대로 남는 어긋난 상태가 생긴다.
  const deleted = await withTransaction(async (tx) => {
    const logs = await tx<DeletedLog>(
      `delete from watering_logs
       where id = $1
       returning id, plant_id, plant_name, watered_at::text, memo, source, created_at, pump_command_id`,
      [id],
    );

    const row = logs[0];
    if (!row) return null;

    // 수동 기록을 지우는 것은 자동급수 잠금과 무관하다.
    // 어떤 실행에서 나온 기록인지 모르면(옛 기록) 잠금은 건드리지 않는다.
    // 날짜만 보고 추측하면 같은 날 다른 급수까지 없던 일로 만들게 된다.
    if (!row.plant_id || row.source !== "automation" || !row.pump_command_id) return row;

    // 취소하는 그 실행 1건만 되돌린다.
    await tx(
      `update pump_commands
       set status = 'cancelled'
       where id = $1 and status = 'completed'`,
      [row.pump_command_id],
    );

    // 쿨다운은 남아 있는 자동급수 실행 중 가장 최근 것으로 다시 맞춘다.
    // 남은 게 없으면 null이 되어 잠금이 풀린다.
    // 수동 펌프 테스트는 애초에 쿨다운을 걸지 않으므로 후보에서 제외한다.
    await tx(
      `update plant_automation_configs a
       set last_run_at = (
             select max(c.completed_at)
             from pump_commands c
             join watering_logs w on w.pump_command_id = c.id
             where c.plant_id = a.plant_id
               and c.status = 'completed'
               and c.reason not like 'manual%'
           ),
           updated_at = now()
       where a.plant_id = $1`,
      [row.plant_id],
    );

    return row;
  });

  if (!deleted) {
    return NextResponse.json({ error: "급수 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
