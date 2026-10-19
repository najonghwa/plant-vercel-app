/**
 * 기록 사진 규칙. 새로 올릴 때(POST)와 고칠 때(PATCH)가 같은 규칙을 써야
 * 한쪽으로 우회해 큰 사진이 들어오지 않는다.
 *
 * 사진은 별도 스토리지 없이 data URL 문자열로 Postgres에 들어간다.
 * 브라우저에서 긴 변 1280px · JPEG로 줄여 올리므로 실제로는 한 장 200KB 안팎이다.
 */
export const MAX_IMAGE_CHARS = 3_000_000; // data URL 기준 약 2.2MB
export const MAX_THUMB_CHARS = 400_000;
/** 식물 한 종당, 그리고 전체 보관 장수 상한. DB가 사진으로 가득 차는 것을 막는다. */
export const MAX_PHOTOS_PER_PLANT = 200;
export const MAX_PHOTOS_TOTAL = 2000;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;

/**
 * 원본과 썸네일을 검사하고 실제로 저장할 썸네일을 정한다.
 * 썸네일을 비워 보내면 원본이 썸네일 자리에 들어간다. 저장될 값으로 검사해야
 * 썸네일 용량 제한이 우회되지 않는다.
 */
export function checkImage(
  imageUrl: string,
  thumbUrl: string,
): { ok: true; thumb: string } | { ok: false; status: number; error: string } {
  if (!DATA_URL.test(imageUrl)) {
    return { ok: false, status: 400, error: "이미지 형식이 올바르지 않습니다." };
  }
  const thumb = thumbUrl || imageUrl;
  if (imageUrl.length > MAX_IMAGE_CHARS || thumb.length > MAX_THUMB_CHARS) {
    return { ok: false, status: 413, error: "사진 용량이 너무 큽니다. 더 작은 사진으로 다시 시도해주세요." };
  }
  if (!DATA_URL.test(thumb)) {
    return { ok: false, status: 400, error: "썸네일 형식이 올바르지 않습니다." };
  }
  return { ok: true, thumb };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 썸네일은 목록 응답에 사진 글자를 싣지 않고 주소만 준다. 화면이 그 주소로 사진을 따로 받는다.
 * 사진 글자를 목록에 박아 두면 썸네일을 키울수록 목록 전체가 무거워져 작게(270px) 둘 수밖에 없었고,
 * 카드에서 흐려 보였다. 주소로 떼면 보이는 것만 받고, 한 번 받은 사진은 브라우저에 남는다.
 * 뒤의 v는 사진이 바뀐 시각 — 사진을 바꾸면 주소가 달라져 옛 사진이 남지 않는다.
 * image_url is not null 로 판단한다. 썸네일 글자를 열어 보지 않아도 된다(사진이 있으면 썸네일도 있다).
 */
export function thumbUrlSql(alias = "") {
  const t = alias ? `${alias}.` : "";
  return `case when ${t}image_url is not null
    then '/api/plant-photos/' || ${t}id || '/thumb?v=' || floor(extract(epoch from ${t}updated_at) * 1000)::bigint
  end`;
}

/** 목록·저장 응답이 같은 모양이 되도록 한 곳에 둔다. 원본(image_url)은 싣지 않는다. */
export const PHOTO_RETURNING = `
  id,
  plant_id,
  (select name from plants where id = plant_id) as plant_name,
  ${thumbUrlSql()} as thumb_url,
  image_url is not null as has_image,
  note,
  captured_at::text,
  created_at`;
