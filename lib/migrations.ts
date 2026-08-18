import { query, withTransaction } from "@/lib/db";

/**
 * 이미 돌고 있는 DB의 스키마를 코드가 기대하는 모양으로 맞춘다.
 * 손으로 SQL을 돌리지 않아도 배포만으로 반영되도록, 프로세스당 한 번만 실행한다.
 */
function once(run: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending) {
      pending = run().catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

/** 서버리스에서는 인스턴스가 여러 개 동시에 뜬다. DDL은 한 번에 하나만 돌게 직렬화한다. */
const LOCK_KEY = 918273645;

/** 펌프 하드웨어의 실제 상한이 15초다. DB 제약이 30초로 남아 있으면 맞춰준다. */
export const ensureWateringSecondsLimit = once(async () => {
  const applied = await query<{ ok: boolean }>(
    `select exists (
       select 1
       from pg_constraint c
       join pg_class r on r.oid = c.conrelid
       where r.relname = 'plant_automation_configs'
         and c.conname = 'plant_automation_configs_watering_seconds_check'
         and pg_get_constraintdef(c.oid) like '%<= 15%'
     ) as ok`,
  );
  // 이미 적용돼 있으면 ALTER를 다시 걸지 않는다. 매 콜드스타트마다 테이블 전체를
  // 다시 검증하고 배타 락을 잡는 것을 피한다.
  if (applied[0]?.ok) return;

  await withTransaction(async (tx) => {
    // 두 인스턴스가 동시에 drop -> add를 하면 뒤쪽이 "이미 존재함"으로 실패한다.
    // 락을 잡아 순서를 만들고, 제약이 비어 있는 구간도 트랜잭션 안으로 숨긴다.
    await tx("select pg_advisory_xact_lock($1)", [LOCK_KEY]);

    // 제약을 바꾸기 전에 기존 값을 범위 안으로 내린다. 그러지 않으면 alter가 실패한다.
    await tx("update plant_automation_configs set watering_seconds = 15 where watering_seconds > 15");
    await tx("update pump_commands set watering_seconds = 15 where watering_seconds > 15");

    await tx(
      `alter table plant_automation_configs
       drop constraint if exists plant_automation_configs_watering_seconds_check`,
    );
    await tx(
      `alter table plant_automation_configs
       add constraint plant_automation_configs_watering_seconds_check
       check (watering_seconds between 1 and 15)`,
    );

    await tx("alter table pump_commands drop constraint if exists pump_commands_watering_seconds_check");
    await tx(
      `alter table pump_commands
       add constraint pump_commands_watering_seconds_check
       check (watering_seconds between 1 and 15)`,
    );

    // 기기별로 처리 중인 명령은 하나뿐이어야 한다. 코드로만 검사하면 동시 요청 두 건이
    // 같은 순간에 통과해 연속 급수가 나간다. DB가 막게 한다.
    await tx(
      `create unique index if not exists pump_commands_one_open_per_device
       on pump_commands (pump_device_id)
       where status in ('pending', 'running')`,
    );
  });
});
