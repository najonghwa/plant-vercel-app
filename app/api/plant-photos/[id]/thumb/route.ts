import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { ensurePlantPhotosTable } from "@/lib/photoTable";

type Params = {
  params: Promise<{ id: string }>;
};

/**
 * 카드에 쓰는 썸네일을 이미지 파일로 내준다.
 * 주소 끝의 ?v=가 사진이 바뀐 시각이라 같은 주소의 내용은 바뀌지 않는다 → 브라우저가 오래 들고 있어도 된다.
 * private: 지운 기록의 사진이 공용 캐시(CDN)에 남지 않게 한다.
 */
export async function GET(_request: Request, { params }: Params) {
  await ensurePlantPhotosTable();
  const { id } = await params;

  const row = await queryOne<{ thumb_url: string }>("select thumb_url from plant_photos where id = $1", [id]);
  const match = row?.thumb_url ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(row.thumb_url) : null;
  if (!match) {
    return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });
  }

  return new NextResponse(Buffer.from(match[2], "base64"), {
    headers: {
      "Content-Type": match[1],
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
