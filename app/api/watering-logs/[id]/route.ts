import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import type { WateringLog } from "@/lib/types";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  // 기록 삭제와 그에 딸린 자동급수 잠금 해제는 한 덩어리다.
  // 따로 실행하면 기록만 사라지고 쿨다운은 그대로 남는 어긋난 상태가 생긴다.
  const deleted = await withTransaction(async (tx) => {
    const logs = await tx<WateringLog>(
      `delete from watering_logs
       where id = $1
       returning id, plant_id, plant_name, watered_at::text, memo, source, created_at`,
      [id],
    );

    const row = logs[0];
    if (!row) return null;

    const plantId = row.plant_id;
    const wateredDate = row.watered_at.slice(0, 10);

    // 수동 기록을 지우는 것은 자동급수 잠금과 무관하다.
    if (!plantId || row.source !== "automation") return row;

    // 지운 기록이 그날의 마지막 자동급수가 아니면, 뒤에 실제로 나간 급수가 남아 있다.
    // 그때 잠금을 풀면 방금 물을 준 화분에 또 물이 나간다.
    const later = await tx<{ id: string }>(
      `select id from watering_logs
       where plant_id = $1
         and source = 'automation'
         and watered_at = $2::date
       limit 1`,
      [plantId, wateredDate],
    );
    if (later.length) return row;

    // 쿨다운은 이 급수 이전의 자동급수 시각으로만 되돌린다.
    // 수동 펌프 테스트(reason이 manual로 시작)는 애초에 쿨다운을 걸지 않으므로 제외한다.
    await tx(
      `update plant_automation_configs a
       set last_run_at = (
             select max(c.completed_at)
             from pump_commands c
             where c.plant_id = a.plant_id
               and c.status = 'completed'
               and c.reason not like 'manual%'
               and c.completed_at < a.last_run_at
           ),
           updated_at = now()
       where a.plant_id = $1
         and a.last_run_at is not null
         and (a.last_run_at at time zone 'Asia/Seoul')::date = $2::date`,
      [plantId, wateredDate],
    );

    // 하루 최대 횟수: 같은 날 완료된 자동급수 명령 중 가장 최근 1건만 취소로 돌린다.
    // 진행 중(pending/running)인 명령은 실제로 물이 나가는 중이라 건드리지 않는다.
    await tx(
      `update pump_commands
       set status = 'cancelled'
       where id = (
         select id
         from pump_commands
         where plant_id = $1
           and status = 'completed'
           and reason not like 'manual%'
           and (requested_at at time zone 'Asia/Seoul')::date = $2::date
         order by requested_at desc
         limit 1
       )`,
      [plantId, wateredDate],
    );

    return row;
  });

  if (!deleted) {
    return NextResponse.json({ error: "급수 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
