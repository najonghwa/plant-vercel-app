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

  return NextResponse.json({ deleted: logs[0] });
}
