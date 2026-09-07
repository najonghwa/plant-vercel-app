/**
 * 도감 표기용 학명. 한글 이름으로 찾는다.
 * 여기 없는 식물은 학명 줄을 그냥 비운다. 새 식물을 들이면 한 줄 추가하면 된다.
 * 이름에 숫자 접미(고무나무미니1)나 공백이 붙어도 찾도록 앞부분 일치로 본다.
 */
const LATIN_NAMES: Record<string, string> = {
  고무나무미니: "Ficus elastica",
  고무나무: "Ficus elastica",
  라임오렌지나무: "Citrus × sinensis",
  레몬타임: "Thymus citriodorus",
  아틀란티스: "Sedum takesimense",
  오렌지자스민: "Murraya paniculata",
  올리브: "Olea europaea",
  유칼립투스: "Eucalyptus gunnii",
  로즈마리: "Salvia rosmarinus",
  바질: "Ocimum basilicum",
  블루베리: "Vaccinium corymbosum",
  샐러리: "Apium graveolens",
  셀러리: "Apium graveolens",
  알로카시아: "Alocasia",
  케일: "Brassica oleracea",
  파슬리: "Petroselinum crispum",
  루꼴라: "Eruca vesicaria",
  루콜라: "Eruca vesicaria",
  민트: "Mentha",
  라벤더: "Lavandula",
  몬스테라: "Monstera deliciosa",
  스투키: "Sansevieria cylindrica",
  산세베리아: "Dracaena trifasciata",
  스킨답서스: "Epipremnum aureum",
  아이비: "Hedera helix",
  제라늄: "Pelargonium",
  다육: "Succulenta",
  선인장: "Cactaceae",
  토마토: "Solanum lycopersicum",
  상추: "Lactuca sativa",
  깻잎: "Perilla frutescens",
  고추: "Capsicum annuum",
};

const KEYS = Object.keys(LATIN_NAMES).sort((a, b) => b.length - a.length);

export function latinNameFor(koreanName: string): string | null {
  const name = koreanName.trim();
  if (!name) return null;
  if (LATIN_NAMES[name]) return LATIN_NAMES[name];
  // 긴 키부터 대조해 "고무나무미니1"이 "고무나무"보다 "고무나무미니"에 먼저 걸리게 한다.
  const hit = KEYS.find((key) => name.startsWith(key));
  return hit ? LATIN_NAMES[hit] : null;
}
