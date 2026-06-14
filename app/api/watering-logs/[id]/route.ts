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

  // 급수 기록을 취소하면 자동급수 잠금(쿨다운/하루 횟수)도 함께 해제한다.
  const plantId = logs[0].plant_id;
  if (plantId) {
    // 1) 쿨다운 해제: 마지막 급수 시각을 비워 다시 줄 수 있게 함
    await query(
      `update plant_automation_configs
       set last_run_at = null, updated_at = now()
       where plant_id = $1`,
      [plantId],
    );

    // 2) 하루 최대 횟수 해제: 오늘 발행된 펌프 명령을 취소 처리해 카운트에서 제외
    await query(
      `update pump_commands
       set status = 'cancelled', completed_at = now()
       where plant_id = $1
         and requested_at::date = current_date
         and status in ('pending', 'running', 'completed')`,
      [plantId],
    );
  }

  return NextResponse.json({ deleted: logs[0] });
}
