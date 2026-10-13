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

/**
 * 이름이나 분류를 고친다. 화면에 식물을 고치는 자리가 아직 없어, 잘못 적은 이름은
 * 지우고 다시 들이는 수밖에 없었다. 그러면 급수 기록이 끊긴다.
 *
 * 급수 기록과 펌프 명령은 식물 이름을 글자로 따로 들고 있고 화면도 그 글자로
 * 기록을 묶는다. 이름을 바꾸면 그 글자까지 같이 바꿔야 기록이 따라온다.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const plant = await queryOne<{ id: string; name: string; category: string }>(
    "select id, name, category from plants where id = $1",
    [id],
  );
  if (!plant) {
    return NextResponse.json({ error: "식물을 찾을 수 없습니다." }, { status: 404 });
  }

  const name = body.name === undefined ? plant.name : String(body.name).trim();
  const category = body.category === undefined ? plant.category : String(body.category).trim();
  if (!name) {
    return NextResponse.json({ error: "식물 이름이 필요합니다." }, { status: 400 });
  }

  if (name !== plant.name) {
    const taken = await queryOne<{ id: string }>("select id from plants where name = $1 and id <> $2", [name, id]);
    if (taken) {
      return NextResponse.json({ error: `'${name}'은(는) 이미 등록된 식물입니다.` }, { status: 409 });
    }
  }

  await withTransaction(async (tx) => {
    await tx("update plants set name = $2, category = $3, updated_at = now() where id = $1", [id, name, category]);
    if (name !== plant.name) {
      // 옛날에 들여온 기록은 plant_id 없이 이름만 있는 것도 있어, 이름으로도 맞춘다.
      await tx(
        "update watering_logs set plant_name = $2 where plant_id = $1 or (plant_id is null and plant_name = $3)",
        [id, name, plant.name],
      );
      await tx("update pump_commands set plant_name = $2 where plant_id = $1", [id, name]);
    }
  });

  return NextResponse.json({ plant: { ...plant, name, category } });
}
