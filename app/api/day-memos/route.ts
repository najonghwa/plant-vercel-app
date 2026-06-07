import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { DayMemo } from "@/lib/types";

async function ensureMemoTable() {
  await query("create extension if not exists pgcrypto");
  await query(
    `create table if not exists day_memos (
       id uuid primary key default gen_random_uuid(),
       entry_date date not null,
       content text not null default '',
       created_at timestamptz not null default now()
     )`,
  );
}

export async function GET() {
  await ensureMemoTable();

  const memos = await query<DayMemo>(
    `select
       id,
       to_char(entry_date, 'YYYY-MM-DD') as entry_date,
       content,
       created_at
     from day_memos
     order by entry_date desc, created_at desc`,
  );

  return NextResponse.json({ memos });
}

export async function POST(request: Request) {
  await ensureMemoTable();

  const body = await request.json();
  const entryDate = String(body.entry_date ?? "").trim();
  const content = String(body.content ?? "").trim();

  if (!entryDate) {
    return NextResponse.json({ error: "날짜(entry_date)가 필요합니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "메모 내용이 필요합니다." }, { status: 400 });
  }

  const memos = await query<DayMemo>(
    `insert into day_memos (entry_date, content)
     values ($1, $2)
     returning
       id,
       to_char(entry_date, 'YYYY-MM-DD') as entry_date,
       content,
       created_at`,
    [entryDate, content],
  );

  return NextResponse.json({ memo: memos[0] }, { status: 201 });
}
