/**
 * 도감 삽화. 식물 이름/분류로 형태를 골라 잉크 선화 + 옅은 채색으로 그린다.
 *
 * 잎을 하나하나 좌표로 박아두면 형태를 늘릴 때마다 손이 많이 간다.
 * 잎 하나를 (시작점, 각도, 길이, 폭)으로 만드는 함수를 두고 그것만 배치한다.
 */

import { memo } from "react";
import type { JSX } from "react";

type Tone = "leaf" | "warm" | "rose" | "plum";

export type PlantForm =
  | "herb"
  | "eucalyptus"
  | "tree"
  | "citrus"
  | "berry"
  | "broadleaf"
  | "rosette"
  | "needle"
  | "frilly"
  | "fruit"
  | "cactus";

const r1 = (n: number) => Math.round(n * 10) / 10;

function vec(deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { dx: Math.cos(rad), dy: Math.sin(rad) };
}

/** 잎 윤곽. 두 번의 곡선으로 좌우 대칭인 볼록한 잎을 만든다. */
function leafOutline(x: number, y: number, deg: number, len: number, w: number) {
  const { dx, dy } = vec(deg);
  const nx = -dy * w;
  const ny = dx * w;
  const p = (t: number, side: number): [number, number] => [
    r1(x + dx * len * t + nx * side),
    r1(y + dy * len * t + ny * side),
  ];
  const [ax, ay] = p(0.32, 1);
  const [bx, by] = p(0.74, 0.78);
  const [cx, cy] = p(0.74, -0.78);
  const [ex, ey] = p(0.32, -1);
  const tx = r1(x + dx * len);
  const ty = r1(y + dy * len);
  return `M${r1(x)} ${r1(y)} C${ax} ${ay} ${bx} ${by} ${tx} ${ty} C${cx} ${cy} ${ex} ${ey} ${r1(x)} ${r1(y)}Z`;
}

function ribLine(x: number, y: number, deg: number, len: number, w: number) {
  const { dx, dy } = vec(deg);
  // 곧은 선은 기계처럼 보인다. 폭의 일부만큼 한쪽으로 살짝 휘게 한다.
  const bend = w * 0.18;
  const cx = x + dx * len * 0.5 - dy * bend;
  const cy = y + dy * len * 0.5 + dx * bend;
  return `M${r1(x)} ${r1(y)} Q${r1(cx)} ${r1(cy)} ${r1(x + dx * len * 0.94)} ${r1(y + dy * len * 0.94)}`;
}

/** 잎 안쪽에 얹는 두 번째 물감층. 밑동 쪽이 짙고 끝으로 갈수록 옅어 보이게 작게 그린다. */
function leafShade(x: number, y: number, deg: number, len: number, w: number) {
  const { dx, dy } = vec(deg);
  return leafOutline(x + dx * len * 0.06, y + dy * len * 0.06, deg, len * 0.72, w * 0.58);
}

/** 잎맥. 중앙맥에서 좌우로 뻗는 짧은 선. */
function veinLines(x: number, y: number, deg: number, len: number, w: number, count: number) {
  const { dx, dy } = vec(deg);
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = 0.22 + (0.52 * i) / count;
    const bx = x + dx * len * t;
    const by = y + dy * len * t;
    const reach = w * 0.72 * (1 - t * 0.55);
    for (const side of [1, -1]) {
      const { dx: vx, dy: vy } = vec(deg + side * 52);
      out.push(`M${r1(bx)} ${r1(by)} L${r1(bx + vx * reach)} ${r1(by + vy * reach)}`);
    }
  }
  return out;
}

type LeafProps = {
  x: number;
  y: number;
  deg: number;
  len: number;
  w: number;
  veins?: number;
  tone?: Tone;
};

function Leaf({ x, y, deg, len, w, veins = 2, tone = "leaf" }: LeafProps) {
  return (
    <g>
      <path className={`art-fill art-${tone}`} d={leafOutline(x, y, deg, len, w)} />
      <path className="art-shade" d={leafShade(x, y, deg, len, w)} />
      <path className="art-rib" d={ribLine(x, y, deg, len, w)} />
      {veins > 0 &&
        veinLines(x, y, deg, len, w, veins).map((d, index) => (
          <path className="art-vein" d={d} key={index} />
        ))}
    </g>
  );
}

function Berry({
  x,
  y,
  radius,
  tone = "plum",
}: {
  x: number;
  y: number;
  radius: number;
  tone?: Tone;
}) {
  return (
    <g>
      <circle className={`art-fill art-${tone}`} cx={x} cy={y} r={radius} />
      <circle className="art-gloss" cx={r1(x - radius * 0.32)} cy={r1(y - radius * 0.36)} r={r1(radius * 0.22)} />
      <path d={`M${x} ${r1(y - radius)} L${x} ${r1(y - radius - radius * 0.55)}`} />
    </g>
  );
}

const Ground = () => (
  <g>
    <ellipse className="art-shadow" cx="116" cy="309" rx="46" ry="5" />
    <path d="M86 303 C98 297 134 297 146 303" />
    <path d="M74 311 L158 311" />
  </g>
);

/** 줄기를 따라 좌우로 붙는 잎 한 쌍. */
function Pair({
  y,
  len,
  w,
  spread,
  x = 116,
  veins = 2,
  tone = "leaf",
}: {
  y: number;
  len: number;
  w: number;
  spread: number;
  x?: number;
  veins?: number;
  tone?: Tone;
}) {
  return (
    <>
      <Leaf x={x} y={y} deg={180 + spread} len={len} w={w} veins={veins} tone={tone} />
      <Leaf x={x} y={y} deg={-spread} len={len} w={w} veins={veins} tone={tone} />
    </>
  );
}

const FORMS: Record<PlantForm, () => JSX.Element> = {
  // 바질·민트처럼 마주나는 잎
  herb: () => (
    <>
      <path d="M116 304 C113 252 117 186 117 74" />
      <Pair y={254} len={78} w={27} spread={16} veins={3} />
      <Pair y={206} len={70} w={25} spread={20} veins={3} />
      <Pair y={158} len={60} w={22} spread={22} veins={2} />
      <Pair y={112} len={48} w={18} spread={26} veins={2} />
      <Leaf x={117} y={88} deg={248} len={30} w={11} veins={1} />
      <Leaf x={117} y={88} deg={292} len={30} w={11} veins={1} />
      <Leaf x={117} y={80} deg={270} len={24} w={9} veins={0} />
      <Ground />
    </>
  ),

  // 유칼립투스: 둥근 잎이 마주난다
  eucalyptus: () => (
    <>
      <path d="M116 304 C110 240 120 152 116 52" />
      <Pair y={252} len={56} w={33} spread={8} veins={2} />
      <Pair y={204} len={50} w={30} spread={10} veins={2} />
      <Pair y={156} len={44} w={26} spread={12} veins={2} />
      <Pair y={110} len={36} w={21} spread={16} veins={1} />
      <Pair y={72} len={26} w={15} spread={26} veins={0} />
      <Ground />
    </>
  ),

  // 고무나무·올리브 같은 목본
  tree: () => (
    <>
      <path d="M116 304 C113 268 117 244 116 214" />
      <path d="M116 214 C102 200 88 188 72 178" />
      <path d="M116 214 C130 198 146 186 162 176" />
      <path d="M116 220 C117 192 115 170 116 144" />
      <Leaf x={100} y={198} deg={232} len={40} w={14} />
      <Leaf x={86} y={188} deg={196} len={42} w={15} />
      <Leaf x={72} y={178} deg={248} len={38} w={13} />
      <Leaf x={72} y={178} deg={168} len={36} w={13} />
      <Leaf x={132} y={196} deg={308} len={40} w={14} />
      <Leaf x={146} y={186} deg={344} len={42} w={15} />
      <Leaf x={162} y={176} deg={292} len={38} w={13} />
      <Leaf x={162} y={176} deg={12} len={36} w={13} />
      <Leaf x={116} y={192} deg={250} len={36} w={13} />
      <Leaf x={116} y={192} deg={290} len={36} w={13} />
      <Leaf x={116} y={162} deg={244} len={34} w={12} />
      <Leaf x={116} y={162} deg={296} len={34} w={12} />
      <Leaf x={116} y={144} deg={270} len={42} w={15} />
      <Ground />
    </>
  ),

  // 감귤류: 가지에 열매가 달린다
  citrus: () => (
    <>
      <path d="M116 304 C113 266 117 242 116 212" />
      <path d="M116 212 C100 198 86 190 70 182" />
      <path d="M116 212 C132 196 148 186 164 178" />
      <path d="M116 218 C117 190 115 168 116 146" />
      <Leaf x={98} y={198} deg={228} len={38} w={15} />
      <Leaf x={70} y={182} deg={196} len={40} w={16} />
      <Leaf x={70} y={182} deg={250} len={34} w={13} />
      <Leaf x={134} y={196} deg={312} len={38} w={15} />
      <Leaf x={164} y={178} deg={344} len={40} w={16} />
      <Leaf x={164} y={178} deg={290} len={34} w={13} />
      <Leaf x={116} y={168} deg={252} len={34} w={13} />
      <Leaf x={116} y={146} deg={286} len={40} w={15} />
      <Berry x={90} y={216} radius={17} tone="warm" />
      <Berry x={148} y={202} radius={14} tone="warm" />
      <Ground />
    </>
  ),

  // 블루베리: 늘어진 가지에 열매 송이
  berry: () => (
    <>
      <path d="M116 304 C110 258 102 220 84 190" />
      <path d="M116 302 C122 256 136 222 154 196" />
      <path d="M116 303 C116 252 116 212 116 176" />
      <Leaf x={104} y={252} deg={206} len={34} w={12} />
      <Leaf x={128} y={248} deg={334} len={34} w={12} />
      <Leaf x={116} y={228} deg={258} len={32} w={11} />
      <Leaf x={116} y={200} deg={288} len={30} w={11} />
      <Berry x={78} y={182} radius={8} />
      <Berry x={92} y={176} radius={7} />
      <Berry x={70} y={194} radius={7} />
      <Berry x={160} y={188} radius={8} />
      <Berry x={148} y={180} radius={7} />
      <Berry x={166} y={200} radius={6} />
      <Berry x={110} y={168} radius={8} />
      <Berry x={124} y={162} radius={7} />
      <Ground />
    </>
  ),

  // 알로카시아·몬스테라처럼 잎자루 끝에 큰 잎
  broadleaf: () => (
    <>
      <path d="M116 304 C106 258 90 218 74 188" />
      <path d="M116 304 C116 252 116 208 116 170" />
      <path d="M116 304 C126 258 144 220 160 192" />
      <Leaf x={74} y={188} deg={244} len={84} w={39} veins={4} />
      <Leaf x={116} y={170} deg={270} len={94} w={43} veins={4} />
      <Leaf x={160} y={192} deg={296} len={84} w={39} veins={4} />
      <Ground />
    </>
  ),

  // 다육·세덤: 낮은 중심에서 잎이 방사한다
  rosette: () => (
    <>
      <Leaf x={116} y={272} deg={178} len={62} w={22} veins={1} />
      <Leaf x={116} y={272} deg={2} len={62} w={22} veins={1} />
      <Leaf x={116} y={270} deg={202} len={72} w={24} veins={1} />
      <Leaf x={116} y={270} deg={338} len={72} w={24} veins={1} />
      <Leaf x={116} y={268} deg={228} len={78} w={25} veins={1} />
      <Leaf x={116} y={268} deg={312} len={78} w={25} veins={1} />
      <Leaf x={116} y={266} deg={252} len={80} w={26} veins={1} />
      <Leaf x={116} y={266} deg={288} len={80} w={26} veins={1} />
      <Leaf x={116} y={262} deg={215} len={50} w={18} veins={0} />
      <Leaf x={116} y={262} deg={325} len={50} w={18} veins={0} />
      <Leaf x={116} y={260} deg={248} len={54} w={19} veins={0} />
      <Leaf x={116} y={260} deg={292} len={54} w={19} veins={0} />
      <Leaf x={116} y={256} deg={264} len={32} w={12} veins={0} />
      <Leaf x={116} y={256} deg={276} len={30} w={11} veins={0} />
      <Ground />
    </>
  ),

  // 로즈마리·타임: 가는 줄기에 바늘잎
  needle: () => {
    // 줄기를 붙여 세우면 바늘이 겹쳐 검은 덩어리로 보인다. 밑동부터 벌려 세운다.
    const stems: Array<{ d: string; x: number; top: number; count: number; drift: number }> = [
      { d: "M112 304 C102 256 94 210 90 166", x: 112, top: 166, count: 6, drift: -22 },
      { d: "M120 304 C130 256 138 212 142 172", x: 120, top: 172, count: 6, drift: 22 },
      { d: "M116 304 C116 258 115 212 116 180", x: 116, top: 180, count: 6, drift: 0 },
    ];
    return (
      <>
        {stems.map((stem) => (
          <g key={stem.d}>
            <path d={stem.d} />
            {Array.from({ length: stem.count }, (_, i) => {
              const t = (i + 1) / (stem.count + 1);
              const y = 296 - (296 - stem.top) * t;
              const x = stem.x + stem.drift * t * t;
              return (
                <g key={y}>
                  <Leaf x={x} y={y} deg={214} len={26} w={4.2} veins={0} />
                  <Leaf x={x} y={y} deg={326} len={26} w={4.2} veins={0} />
                </g>
              );
            })}
          </g>
        ))}
        <Ground />
      </>
    );
  },

  // 파슬리·케일: 잎자루 끝에 잔잎이 뭉친다
  frilly: () => {
    const tips: Array<[number, number]> = [
      [82, 208],
      [116, 194],
      [152, 212],
    ];
    return (
      <>
        <path d="M116 304 C108 264 96 232 82 208" />
        <path d="M116 304 C116 260 116 224 116 194" />
        <path d="M116 304 C124 264 138 234 152 212" />
        {tips.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            {[198, 232, 266, 300, 334].map((deg, index) => (
              <Leaf
                x={x}
                y={y}
                deg={deg}
                len={index === 2 ? 38 : 32}
                w={index === 2 ? 15 : 13}
                veins={2}
                key={deg}
              />
            ))}
          </g>
        ))}
        <Ground />
      </>
    );
  },

  // 토마토·고추: 잎 사이에 열매가 달린다
  fruit: () => (
    <>
      <path d="M116 304 C112 250 118 196 116 146" />
      <Pair y={256} len={58} w={21} spread={18} veins={3} />
      <Pair y={206} len={52} w={19} spread={22} veins={3} />
      <Pair y={162} len={42} w={16} spread={26} veins={2} />
      <Leaf x={116} y={146} deg={270} len={30} w={11} veins={1} />
      <Berry x={88} y={230} radius={15} tone="rose" />
      <Berry x={146} y={196} radius={13} tone="rose" />
      <Berry x={104} y={252} radius={11} tone="rose" />
      <Ground />
    </>
  ),

  cactus: () => (
    <>
      <path className="art-fill art-leaf" d="M98 300 L98 202 C98 176 134 176 134 202 L134 300 Z" />
      <path
        className="art-fill art-leaf"
        d="M98 246 C82 246 76 234 76 220 C76 204 92 204 92 220 C92 232 96 236 98 236 Z"
      />
      <path
        className="art-fill art-leaf"
        d="M134 226 C150 226 156 214 156 200 C156 184 140 184 140 200 C140 212 136 216 134 216 Z"
      />
      <path d="M110 300 L110 200 M122 300 L122 200" />
      <path d="M84 238 L84 222 M148 218 L148 202" />
      {[196, 214, 232, 250, 268, 286].map((y) => (
        <g key={y}>
          <path d={`M98 ${y} L92 ${y - 4}`} />
          <path d={`M134 ${y} L140 ${y - 4}`} />
          <path d={`M116 ${y} L116 ${y - 5}`} />
        </g>
      ))}
      <Ground />
    </>
  ),
};

const KEYWORD_FORMS: Record<string, PlantForm> = {
  고무나무: "tree",
  올리브: "tree",
  오렌지자스민: "tree",
  동백: "tree",
  월계수: "tree",
  유칼립투스: "eucalyptus",
  라임오렌지나무: "citrus",
  라임오렌지: "citrus",
  오렌지: "citrus",
  레몬: "citrus",
  라임: "citrus",
  금귤: "citrus",
  블루베리: "berry",
  베리: "berry",
  포도: "berry",
  알로카시아: "broadleaf",
  몬스테라: "broadleaf",
  스킨답서스: "broadleaf",
  아이비: "broadleaf",
  필로덴드론: "broadleaf",
  여인초: "broadleaf",
  아틀란티스: "rosette",
  다육: "rosette",
  세덤: "rosette",
  에케베리아: "rosette",
  산세베리아: "rosette",
  스투키: "rosette",
  알로에: "rosette",
  로즈마리: "needle",
  라벤더: "needle",
  레몬타임: "needle",
  타임: "needle",
  파슬리: "frilly",
  케일: "frilly",
  셀러리: "frilly",
  샐러리: "frilly",
  루꼴라: "frilly",
  루콜라: "frilly",
  상추: "frilly",
  깻잎: "frilly",
  치커리: "frilly",
  시금치: "frilly",
  토마토: "fruit",
  고추: "fruit",
  파프리카: "fruit",
  딸기: "fruit",
  가지: "fruit",
  선인장: "cactus",
  바질: "herb",
  민트: "herb",
  제라늄: "herb",
  바이올렛: "herb",
};

// 긴 이름부터 맞춰야 "레몬타임"이 "레몬"으로 넘어가지 않는다.
const KEYWORDS = Object.keys(KEYWORD_FORMS).sort((a, b) => b.length - a.length);

const CATEGORY_FORMS: Record<string, PlantForm> = {
  허브: "herb",
  목본: "tree",
  과수: "citrus",
  채소: "frilly",
  엽채: "frilly",
  다육: "rosette",
  관엽: "broadleaf",
  화훼: "herb",
};

/** 아는 이름이 아니어도 식물마다 다른 그림이 나오게 이름으로 고르게 섞는다. */
const FALLBACK: PlantForm[] = ["herb", "eucalyptus", "broadleaf", "frilly", "tree", "rosette"];

export function formFor(name: string, category?: string): PlantForm {
  const plain = (name ?? "").replace(/\s/g, "");
  const hit = KEYWORDS.find((keyword) => plain.includes(keyword));
  if (hit) return KEYWORD_FORMS[hit];

  const categoryHit = Object.keys(CATEGORY_FORMS).find((key) => (category ?? "").includes(key));
  if (categoryHit) return CATEGORY_FORMS[categoryHit];

  let sum = 0;
  for (let i = 0; i < plain.length; i += 1) sum += plain.charCodeAt(i);
  return FALLBACK[sum % FALLBACK.length];
}

/**
 * 삽화 한 장이 path 80~120개다. 관리판에는 카드가 15장 붙으니, 상태가 바뀔 때마다
 * 전부 다시 만들지 않도록 memo로 감싼다. 이름/분류가 같으면 그림도 같다.
 *
 * aria-hidden인 이유: 어느 자리에서든 바로 옆에 식물 이름이 글자로 있다.
 * 그림에 이름을 또 달면 카드 버튼의 읽히는 이름이 "바질 삽화 바질 …"로 겹친다.
 */
export const PlantArt = memo(function PlantArt({
  name,
  category,
  className,
}: {
  name: string;
  category?: string;
  className?: string;
}) {
  const form = formFor(name, category);
  const Draw = FORMS[form];
  return (
    <svg
      className={`plant-art${className ? ` ${className}` : ""}`}
      viewBox="0 0 232 320"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <Draw />
    </svg>
  );
});
