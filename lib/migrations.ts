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

/**
 * 명령의 소유권과 급수 기록의 출처를 추적하기 위한 컬럼.
 * - pump_commands.claimed_at: 기기가 명령을 실제로 받아간 시각.
 *   이게 없으면 "발행됐지만 아직 아무도 안 가져간 명령"과 "가져갔는데 결과 보고가 없는 명령"을
 *   구분할 수 없어, 회수 기준이 발행 시각이 되어버린다.
 * - watering_logs.pump_command_id: 어떤 자동급수 실행에서 생긴 기록인지.
 *   이게 없으면 기록을 취소할 때 어떤 명령을 되돌려야 하는지 날짜로 추측해야 한다.
 */
export const ensureCommandTracking = once(async () => {
  await query("alter table pump_commands add column if not exists claimed_at timestamptz");
  await query(
    `alter table watering_logs
     add column if not exists pump_command_id uuid references pump_commands(id) on delete set null`,
  );
});

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
    //
    // 다만 지금까지는 제한이 없었으므로 이미 같은 기기에 미처리 명령이 여러 건 쌓여
    // 있을 수 있다. 그대로 두면 인덱스 생성이 실패하고 트랜잭션 전체가 롤백돼
    // 자동급수 설정 저장이 계속 실패한다. 가장 최근 1건만 남기고 정리한다.
    await tx(
      `update pump_commands
       set status = 'cancelled', completed_at = now()
       where status in ('pending', 'running')
         and id not in (
           select distinct on (pump_device_id) id
           from pump_commands
           where status in ('pending', 'running')
           order by pump_device_id, requested_at desc
         )`,
    );

    await tx(
      `create unique index if not exists pump_commands_one_open_per_device
       on pump_commands (pump_device_id)
       where status in ('pending', 'running')`,
    );
  });
});
