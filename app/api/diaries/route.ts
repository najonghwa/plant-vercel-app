import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { DiaryEntry } from "@/lib/types";

async function ensureDiaryTable() {
  await query("create extension if not exists pgcrypto");
  await query(
    `create table if not exists plant_diaries (
       id uuid primary key default gen_random_uuid(),
       plant_id uuid references plants(id) on delete cascade,
       entry_date date not null,
       content text not null default '',
       created_at timestamptz not null default now()
     )`,
  );
}

export async function GET() {
  await ensureDiaryTable();

  const diaries = await query<DiaryEntry>(
    `select
       id,
       plant_id,
       to_char(entry_date, 'YYYY-MM-DD') as entry_date,
       content,
       created_at
     from plant_diaries
     order by entry_date desc, created_at desc`,
  );

  return NextResponse.json({ diaries });
}

export async function POST(request: Request) {
  await ensureDiaryTable();

  const body = await request.json();
  const plantId = body.plant_id ? String(body.plant_id) : null;
  const entryDate = String(body.entry_date ?? "").trim();
  const content = String(body.content ?? "").trim();

  if (!entryDate) {
    return NextResponse.json({ error: "날짜(entry_date)가 필요합니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "일기 내용이 필요합니다." }, { status: 400 });
  }

  const diaries = await query<DiaryEntry>(
    `insert into plant_diaries (plant_id, entry_date, content)
     values ($1, $2, $3)
     returning
       id,
       plant_id,
       to_char(entry_date, 'YYYY-MM-DD') as entry_date,
       content,
       created_at`,
    [plantId, entryDate, content],
  );

  return NextResponse.json({ diary: diaries[0] }, { status: 201 });
}
