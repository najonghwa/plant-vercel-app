import { query } from "@/lib/db";

/**
 * 기록 표(plant_photos) 준비. 요청마다 DDL을 돌리지 않도록 프로세스당 한 번만 실행한다.
 * 목록·한 건·썸네일 경로가 모두 부른다. 어느 경로가 먼저 불릴지 모르기 때문이다.
 */
let tableReady: Promise<void> | null = null;

export function ensurePlantPhotosTable() {
  if (!tableReady) {
    tableReady = migratePlantPhotos().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

async function migratePlantPhotos() {
  await query(
    `create table if not exists plant_photos (
       id uuid primary key default gen_random_uuid(),
       plant_id uuid references plants(id) on delete cascade,
       image_url text,
       note text not null default '',
       captured_at date not null default current_date,
       created_at timestamptz not null default now()
     )`,
  );

  await query("alter table plant_photos add column if not exists thumb_url text not null default ''");
  // 사진 없이 메모만 남기는 기록을 허용한다.
  await query("alter table plant_photos alter column image_url drop not null");
  // 식물 하나에 묶지 않는 "공통" 기록(화분들 모아 찍은 사진 등)을 허용한다.
  await query("alter table plant_photos alter column plant_id drop not null");
  // 썸네일 주소에 붙는 판 번호. 사진을 바꾸면 주소가 바뀌어 브라우저가 옛 사진을 쓰지 않는다.
  await query("alter table plant_photos add column if not exists updated_at timestamptz not null default now()");

  await query(
    `create index if not exists plant_photos_plant_captured_idx
     on plant_photos (plant_id, captured_at desc, created_at desc)`,
  );
}
