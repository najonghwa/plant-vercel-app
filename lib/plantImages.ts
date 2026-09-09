/**
 * 식물 분석 도판에 거는 실제 그림.
 *
 * 대부분 19세기 식물 도감(쾰러·블랑코·토메·리소 등)의 도판이라 저작권이 끝났다.
 * 옛 도판이 없는 두 종(아틀란티스·오렌지자스민)만 위키미디어 공용의 CC BY-SA 사진을
 * 쓰며, 그 조건대로 작가와 라이선스를 화면에 표기한다. 출처는 public/plants/CREDITS.md.
 *
 * 같은 속의 다른 종을 쓴 경우(레몬타임→백리향, 알로카시아→A. metallica)는 depicts에
 * 실제 그림의 종을 적어 화면에서 거짓말하지 않게 한다.
 */

export type PlantImage = {
  /** public/ 아래 경로. */
  src: string;
  kind: "plate" | "photo";
  /** 그림에 실제로 그려진 종. */
  depicts: string;
  /** 화면에 적는 출처 한 줄. */
  credit: string;
  year?: string;
  /** 위키미디어 공용 파일 페이지. CC BY-SA는 링크가 있어야 한다. */
  url: string;
};

const C = "https://commons.wikimedia.org/wiki/File:";

const IMAGES: Record<string, PlantImage> = {
  올리브: {
    src: "/plants/olive.jpg",
    kind: "plate",
    depicts: "Olea europaea",
    credit: "Köhler, Medizinal-Pflanzen",
    year: "1887",
    url: `${C}Olea_europaea_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-229.jpg`,
  },
  고무나무: {
    src: "/plants/ficus.jpg",
    kind: "plate",
    depicts: "Ficus elastica",
    credit: "Köhler, Medizinal-Pflanzen",
    year: "1887",
    url: `${C}Ficus_elastica_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-206.jpg`,
  },
  라임오렌지나무: {
    src: "/plants/citrus.jpg",
    kind: "plate",
    depicts: "Citrus sinensis",
    credit: "Risso & Poiteau, Histoire et culture des orangers",
    year: "1872",
    url: `${C}Histoire_et_culture_des_orangers_A._Risso_et_A._Poiteau._--_Paris_Henri_Plon,_Editeur,_1872.jpg`,
  },
  유칼립투스: {
    src: "/plants/eucalyptus.jpg",
    kind: "plate",
    depicts: "Eucalyptus gunnii",
    credit: "Eucalypts cultivated in the United States",
    year: "1902",
    url: `${C}Eucalyptus_gunnii_from_%22Eucalypts_cultivated_in_the_United_States%22;_(1902)_(14596529088).jpg`,
  },
  블루베리: {
    src: "/plants/blueberry.jpg",
    kind: "plate",
    depicts: "Vaccinium corymbosum",
    credit: "The Botanical Register",
    year: "1815",
    url: `${C}The_Botanical_register_consisting_of_coloured_figures_of_(1815)_(14586523908).jpg`,
  },
  알로카시아: {
    src: "/plants/alocasia.jpg",
    kind: "plate",
    depicts: "Alocasia metallica",
    credit: "Howard & Lowe, Les plantes à feuillage coloré",
    year: "1867",
    url: `${C}Les_plantes_a_feuillage_color%C3%A9_(PL._LX)_(6306113868).jpg`,
  },
  바질: {
    src: "/plants/basil.jpg",
    kind: "plate",
    depicts: "Ocimum basilicum",
    credit: "Blanco, Flora de Filipinas",
    year: "1880",
    url: `${C}Ocimum_basilicum_Blanco2.407.jpg`,
  },
  로즈마리: {
    src: "/plants/rosemary.jpg",
    kind: "plate",
    depicts: "Rosmarinus officinalis",
    credit: "Blanco, Flora de Filipinas",
    year: "1880",
    url: `${C}Rosmarinus_officinalis_Blanco1.94.jpg`,
  },
  레몬타임: {
    src: "/plants/thyme.jpg",
    kind: "plate",
    depicts: "Thymus vulgaris",
    credit: "Köhler, Medizinal-Pflanzen",
    year: "1887",
    url: `${C}Thymus_vulgaris_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-271.jpg`,
  },
  타임: {
    src: "/plants/thyme.jpg",
    kind: "plate",
    depicts: "Thymus vulgaris",
    credit: "Köhler, Medizinal-Pflanzen",
    year: "1887",
    url: `${C}Thymus_vulgaris_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-271.jpg`,
  },
  파슬리: {
    src: "/plants/parsley.jpg",
    kind: "plate",
    depicts: "Petroselinum crispum",
    credit: "Thomé, Flora von Deutschland",
    year: "1885",
    url: `${C}Illustration_Petroselinum_crispum0.jpg`,
  },
  샐러리: {
    src: "/plants/celery.jpg",
    kind: "plate",
    depicts: "Apium graveolens",
    credit: "Flora Batava",
    year: "19세기",
    url: `${C}Apium_graveolens_-_Pl0268_-_FloraBatava-KB-v04.jpg`,
  },
  셀러리: {
    src: "/plants/celery.jpg",
    kind: "plate",
    depicts: "Apium graveolens",
    credit: "Flora Batava",
    year: "19세기",
    url: `${C}Apium_graveolens_-_Pl0268_-_FloraBatava-KB-v04.jpg`,
  },
  루꼴라: {
    src: "/plants/rocket.jpg",
    kind: "plate",
    depicts: "Eruca vesicaria",
    credit: "Sturm, Deutschlands Flora",
    year: "1796",
    url: `${C}Erucastrumsp_and_Eruca_sp_Sturm06035.jpg`,
  },
  루콜라: {
    src: "/plants/rocket.jpg",
    kind: "plate",
    depicts: "Eruca vesicaria",
    credit: "Sturm, Deutschlands Flora",
    year: "1796",
    url: `${C}Erucastrumsp_and_Eruca_sp_Sturm06035.jpg`,
  },
  케일: {
    src: "/plants/kale.jpg",
    kind: "plate",
    depicts: "Brassica oleracea (牡丹菜)",
    credit: "成形図説 Seikei Zusetsu, Leiden Univ. Library",
    year: "1804",
    url: `${C}Leiden_University_Library_-_Seikei_Zusetsu_vol._21,_page_016_-_%E7%89%A1%E4%B8%B9%E8%8F%9C_-_Brassica_oleracea_L.,_1804.jpg`,
  },
  아틀란티스: {
    src: "/plants/sedum.jpg",
    kind: "photo",
    depicts: "Sedum takesimense",
    credit: "사진 Stan Shebs · CC BY-SA 3.0",
    url: `${C}Sedum_takesimense_1.jpg`,
  },
  오렌지자스민: {
    src: "/plants/murraya.jpg",
    kind: "photo",
    depicts: "Murraya paniculata",
    credit: "사진 Chiring chandan · CC BY-SA 4.0",
    url: `${C}Murraya_paniculata_2.jpg`,
  },
};

// 긴 이름부터 맞춰야 "고무나무미니1"이 "고무나무"에 걸리고 "레몬타임"이 "레몬"에 안 걸린다.
const KEYS = Object.keys(IMAGES).sort((a, b) => b.length - a.length);

export function imageFor(name: string): PlantImage | null {
  const plain = (name ?? "").replace(/\s/g, "");
  const hit = KEYS.find((key) => plain.includes(key));
  return hit ? IMAGES[hit] : null;
}
