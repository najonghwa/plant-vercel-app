import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { WateringLog } from "@/lib/types";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const logs = await query<WateringLog>(
    `delete from watering_logs
     where id = $1
     returning id, plant_id, plant_name, watered_at::text, memo, source, created_at`,
    [id],
  );

  if (!logs[0]) {
    return NextResponse.json({ error: "급수 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  // 자동급수 잠금 해제는 "취소한 그 급수"에만 대응해야 한다.
  // 예전에는 날짜와 출처를 가리지 않고 풀어버려서, 지난달 수동 기록 하나를 지우면
  // 오늘 이미 두 번 나간 자동급수의 쿨다운과 하루 횟수까지 초기화돼 과습으로 이어졌다.
  const deleted = logs[0];
  const plantId = deleted.plant_id;
  const wateredDate = deleted.watered_at.slice(0, 10);

  if (plantId && deleted.source === "automation") {
    // 1) 쿨다운: 지운 기록과 같은 날의 last_run_at만 이전 자동급수 시각으로 되돌린다.
    await query(
      `update plant_automation_configs a
       set last_run_at = (
             select max(c.completed_at)
             from pump_commands c
             where c.plant_id = a.plant_id
               and c.status = 'completed'
               and (c.completed_at at time zone 'Asia/Seoul')::date < $2::date
           ),
           updated_at = now()
       where a.plant_id = $1
         and (a.last_run_at at time zone 'Asia/Seoul')::date = $2::date`,
      [plantId, wateredDate],
    );

    // 2) 하루 최대 횟수: 같은 날 완료된 명령 중 가장 최근 1건만 취소로 돌린다.
    //    진행 중(pending/running)인 명령은 실제로 물이 나가는 중이므로 건드리지 않는다.
    await query(
      `update pump_commands
       set status = 'cancelled', completed_at = completed_at
       where id = (
         select id
         from pump_commands
         where plant_id = $1
           and status = 'completed'
           and (requested_at at time zone 'Asia/Seoul')::date = $2::date
         order by requested_at desc
         limit 1
       )`,
      [plantId, wateredDate],
    );
  }

  return NextResponse.json({ deleted: logs[0] });
}
