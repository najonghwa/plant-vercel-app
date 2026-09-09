/**
 * 식물 그림. 굵은 외곽선 + 납작한 색의 만화풍.
 *
 * 앞서 두 번 실패했다. 첫 번째는 잎 하나를 (각도·길이·폭)으로 만드는 함수로 전부
 * 찍어내서, 어느 식물이나 비슷한 타원 잎이 붙은 막대가 됐다. 두 번째는 옛 도감
 * 스캔을 걸었는데 책 여백·제본선·독일어 캡션에 한 장에 두 종까지 들어가 더 나빴다.
 *
 * 그래서 여기서는 종마다 **알아보는 특징 하나**를 정해 그것만 크게, 하나만 그린다.
 * 유칼립투스는 줄기를 감싸는 둥근 잎, 알로카시아는 화살촉 잎의 흰 잎맥,
 * 고무나무는 두꺼운 잎과 붉은 새순, 스투키는 곧은 원통 잎.
 * 화분을 공통으로 깔아 어느 그림이든 "키우는 화분"으로 읽히게 한다.
 */

import { memo } from "react";
import type { JSX } from "react";

export type PlantForm =
  | "basil"
  | "rosemary"
  | "thyme"
  | "eucalyptus"
  | "citrus"
  | "jasmine"
  | "olive"
  | "blueberry"
  | "ficus"
  | "alocasia"
  | "rosette"
  | "snake"
  | "parsley"
  | "kale"
  | "tomato"
  | "celery"
  | "rocket"
  | "cactus";

/* 색은 CSS 변수로 두어 종이 배경에 맞춰 한 곳에서 조절한다. */
const G = "var(--toon-leaf)";
const GD = "var(--toon-leaf-deep)";
const GL = "var(--toon-leaf-pale)";
const SILVER = "var(--toon-silver)";
const CREAM = "var(--toon-cream)";
const ORANGE = "var(--toon-orange)";
const RED = "var(--toon-red)";
const BLUE = "var(--toon-blue)";
const WHITE = "var(--toon-white)";
const OLIVE = "var(--toon-olive)";

/** 공통 화분. 모든 그림이 이 위에 선다. */
const Pot = () => (
  <g>
    <path className="tn-pot" d="M64 178 H136 L129 226 Q128 232 122 232 H78 Q72 232 71 226 Z" />
    <path className="tn-pot-rim" d="M58 164 H142 Q146 164 146 168 V178 Q146 182 142 182 H58 Q54 182 54 178 V168 Q54 164 58 164 Z" />
  </g>
);

/** 잎 하나. 밑동에서 끝까지 부드럽게 부푼 모양. */
function Leaf({
  x,
  y,
  deg,
  len,
  w,
  fill = G,
  vein = true,
}: {
  x: number;
  y: number;
  deg: number;
  len: number;
  w: number;
  fill?: string;
  vein?: boolean;
}) {
  const r = (deg * Math.PI) / 180;
  const dx = Math.cos(r);
  const dy = Math.sin(r);
  const nx = -dy;
  const ny = dx;
  const p = (t: number, s: number) =>
    `${(x + dx * len * t + nx * w * s).toFixed(1)} ${(y + dy * len * t + ny * w * s).toFixed(1)}`;
  const tip = `${(x + dx * len).toFixed(1)} ${(y + dy * len).toFixed(1)}`;
  return (
    <g>
      <path
        fill={fill}
        d={`M${x} ${y} C${p(0.3, 1)} ${p(0.72, 0.85)} ${tip} C${p(0.72, -0.85)} ${p(0.3, -1)} ${x} ${y}Z`}
      />
      {vein && <path className="tn-vein" d={`M${x} ${y} L${tip}`} />}
    </g>
  );
}

/** 줄기를 사이에 두고 좌우로 나는 잎 한 쌍. */
const Pair = (p: { y: number; len: number; w: number; spread: number; fill?: string }) => (
  <>
    <Leaf x={100} y={p.y} deg={180 + p.spread} len={p.len} w={p.w} fill={p.fill} />
    <Leaf x={100} y={p.y} deg={-p.spread} len={p.len} w={p.w} fill={p.fill} />
  </>
);

const Berry = (p: { x: number; y: number; r: number; fill: string }) => (
  <circle cx={p.x} cy={p.y} r={p.r} fill={p.fill} />
);

const FORMS: Record<PlantForm, () => JSX.Element> = {
  // 바질: 통통한 달걀꼴 잎이 마주난다
  basil: () => (
    <>
      <Pot />
      <path className="tn-stem" d="M100 178 V70" />
      <Pair y={148} len={52} w={31} spread={16} />
      <Pair y={106} len={42} w={25} spread={22} fill={GL} />
      <Leaf x={100} y={74} deg={252} len={26} w={14} />
      <Leaf x={100} y={74} deg={288} len={26} w={14} />
    </>
  ),

  // 로즈마리: 바늘잎이 빽빽한 곧은 가지
  rosemary: () => (
    <>
      <Pot />
      <path className="tn-stem" d="M100 178 C97 140 103 104 100 62" />
      {Array.from({ length: 9 }, (_, i) => {
        const t = (i + 1) / 10;
        const y = 172 - 106 * t;
        const x = 100 + Math.sin(t * 3.1) * 3;
        return (
          <g key={i}>
            <path className="tn-needle" d={`M${x} ${y} L${x - 26} ${y - 11}`} />
            <path className="tn-needle" d={`M${x} ${y} L${x + 26} ${y - 11}`} />
          </g>
        );
      })}
      <circle cx={100} cy={60} r={5} fill={SILVER} />
    </>
  ),

  // 레몬타임: 아주 작은 잎이 낮게 옆으로 퍼진다
  thyme: () => (
    <>
      <Pot />
      {[-1, 1].map((dir) => (
        <g key={dir}>
          <path
            className="tn-stem"
            d={`M100 174 C${100 + 30 * dir} 162 ${100 + 52 * dir} 146 ${100 + 62 * dir} 122`}
          />
          {Array.from({ length: 5 }, (_, i) => {
            const t = (i + 1) / 5.4;
            const x = 100 + 30 * dir * t + 32 * dir * t * t;
            const y = 174 - 16 * t - 38 * t * t;
            return (
              <g key={i}>
                <ellipse cx={x - 8} cy={y - 2} rx={7.5} ry={5.5} fill={i % 2 ? GL : G} />
                <ellipse cx={x + 8} cy={y + 3} rx={7.5} ry={5.5} fill={i % 2 ? G : GL} />
              </g>
            );
          })}
        </g>
      ))}
    </>
  ),

  // 유칼립투스: 줄기를 감싸듯 마주나는 둥근 은청색 잎
  eucalyptus: () => (
    <>
      <Pot />
      <path className="tn-stem" d="M100 178 V48" />
      {[
        { y: 150, r: 24 },
        { y: 114, r: 21 },
        { y: 82, r: 17 },
      ].map((s, i) => (
        <g key={s.y}>
          <circle cx={100 - s.r - 4} cy={s.y} r={s.r} fill={i % 2 ? GL : SILVER} />
          <circle cx={100 + s.r + 4} cy={s.y} r={s.r} fill={i % 2 ? SILVER : GL} />
          <path className="tn-vein" d={`M${100 - s.r - 4} ${s.y - s.r * 0.45} V${s.y + s.r * 0.45}`} />
          <path className="tn-vein" d={`M${100 + s.r + 4} ${s.y - s.r * 0.45} V${s.y + s.r * 0.45}`} />
        </g>
      ))}
      <circle cx={100} cy={54} r={9} fill={SILVER} />
    </>
  ),

  // 감귤: 가지 하나에 주황 열매
  citrus: () => (
    <>
      <Pot />
      <path className="tn-trunk" d="M100 178 V112" />
      <path className="tn-stem" d="M100 128 L74 106 M100 128 L126 106" />
      <Leaf x={74} y={106} deg={205} len={42} w={21} fill={GD} />
      <Leaf x={126} y={106} deg={-25} len={42} w={21} fill={GD} />
      <Leaf x={100} y={112} deg={250} len={40} w={20} fill={G} />
      <Leaf x={100} y={112} deg={290} len={40} w={20} fill={G} />
      <Berry x={80} y={146} r={20} fill={ORANGE} />
      <Berry x={126} y={138} r={16} fill={ORANGE} />
      <path className="tn-vein" d="M80 130 v-8 M126 124 v-7" />
    </>
  ),

  // 오렌지자스민: 작은 잎에 흰 꽃
  jasmine: () => (
    <>
      <Pot />
      <path className="tn-trunk" d="M100 178 V116" />
      <path className="tn-stem" d="M100 132 L76 112 M100 132 L124 112" />
      <Leaf x={76} y={112} deg={208} len={30} w={14} fill={GD} />
      <Leaf x={124} y={112} deg={-28} len={30} w={14} fill={GD} />
      <Leaf x={100} y={120} deg={248} len={28} w={13} fill={G} />
      <Leaf x={100} y={120} deg={292} len={28} w={13} fill={G} />
      {[
        { cx: 82, cy: 88, s: 1 },
        { cx: 120, cy: 92, s: 0.85 },
      ].map((f) => (
        <g key={f.cx} transform={`translate(${f.cx} ${f.cy}) scale(${f.s})`}>
          {[0, 72, 144, 216, 288].map((a) => {
            const r = (a * Math.PI) / 180;
            const px = Math.cos(r) * 9;
            const py = Math.sin(r) * 9;
            return (
              <ellipse key={a} cx={px} cy={py} rx={7} ry={5} fill={WHITE} transform={`rotate(${a} ${px} ${py})`} />
            );
          })}
          <circle cx={0} cy={0} r={4} fill={ORANGE} />
        </g>
      ))}
    </>
  ),

  // 올리브: 좁고 긴 은회색 잎, 검은 열매
  olive: () => (
    <>
      <Pot />
      <path className="tn-trunk" d="M100 178 C96 154 104 140 100 114" />
      <path className="tn-stem" d="M100 130 L72 112 M100 130 L128 112" />
      <Leaf x={72} y={112} deg={200} len={40} w={10} fill={SILVER} />
      <Leaf x={72} y={112} deg={248} len={34} w={9} fill={GD} />
      <Leaf x={128} y={112} deg={-20} len={40} w={10} fill={SILVER} />
      <Leaf x={128} y={112} deg={-68} len={34} w={9} fill={GD} />
      <Leaf x={100} y={114} deg={244} len={38} w={10} fill={GD} />
      <Leaf x={100} y={114} deg={296} len={38} w={10} fill={SILVER} />
      <Leaf x={100} y={114} deg={270} len={34} w={9} fill={GD} />
      <Berry x={84} y={140} r={8} fill={OLIVE} />
      <Berry x={118} y={134} r={7} fill={OLIVE} />
    </>
  ),

  // 블루베리: 가지 하나에 청보라 열매 송이
  blueberry: () => (
    <>
      <Pot />
      <path className="tn-stem" d="M100 178 C96 146 100 122 100 96" />
      <Leaf x={100} y={140} deg={202} len={34} w={16} fill={GD} />
      <Leaf x={100} y={124} deg={-22} len={34} w={16} fill={G} />
      <Leaf x={100} y={100} deg={248} len={30} w={14} fill={G} />
      <Leaf x={100} y={100} deg={292} len={30} w={14} fill={GD} />
      {[
        { x: 76, y: 132, r: 11 },
        { x: 62, y: 148, r: 9 },
        { x: 88, y: 152, r: 10 },
        { x: 128, y: 126, r: 10 },
        { x: 140, y: 142, r: 8 },
      ].map((b) => (
        <g key={`${b.x}-${b.y}`}>
          <Berry x={b.x} y={b.y} r={b.r} fill={BLUE} />
          <circle cx={b.x - b.r * 0.3} cy={b.y - b.r * 0.35} r={b.r * 0.24} fill={WHITE} opacity={0.8} />
        </g>
      ))}
    </>
  ),

  // 고무나무: 두껍고 큰 광택 잎, 붉은 새순
  ficus: () => (
    <>
      <Pot />
      <path className="tn-trunk" d="M100 178 V62" />
      <Leaf x={100} y={158} deg={198} len={56} w={29} fill={GD} />
      <Leaf x={100} y={136} deg={-18} len={56} w={29} fill={G} />
      <Leaf x={100} y={112} deg={202} len={48} w={25} fill={G} />
      <Leaf x={100} y={90} deg={-22} len={48} w={25} fill={GD} />
      <path fill={RED} d="M100 64 C93 52 95 38 100 28 C105 38 107 52 100 64Z" />
    </>
  ),

  // 알로카시아: 화살촉 잎에 굵은 흰 잎맥
  alocasia: () => {
    const Arrow = ({ x, y, s, rot }: { x: number; y: number; s: number; rot: number }) => (
      <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
        <path
          fill={GD}
          d="M0 0 C-30 -16 -40 -50 -30 -76 C-18 -100 0 -112 0 -112 C0 -112 18 -100 30 -76 C40 -50 30 -16 0 0Z"
        />
        <path className="tn-vein-bold" d="M0 -6 V-104" />
        <path className="tn-vein-bold" d="M0 -34 L-22 -54 M0 -34 L22 -54 M0 -62 L-17 -78 M0 -62 L17 -78" />
      </g>
    );
    return (
      <>
        <Pot />
        <path className="tn-stem" d="M100 178 V96 M100 178 C112 152 122 138 130 124" />
        <Arrow x={130} y={126} s={0.45} rot={26} />
        <Arrow x={100} y={98} s={0.86} rot={0} />
      </>
    );
  },

  // 다육 로제트: 크림색이 든 통통한 잎
  rosette: () => (
    <>
      <Pot />
      {[
        { r: 52, w: 18, n: 8, fill: G, off: 0 },
        { r: 36, w: 14, n: 6, fill: GL, off: 30 },
        { r: 20, w: 10, n: 5, fill: CREAM, off: 12 },
      ].map((ring) => (
        <g key={ring.r}>
          {Array.from({ length: ring.n }, (_, i) => (
            <Leaf
              key={i}
              x={100}
              y={148}
              deg={ring.off + (360 / ring.n) * i}
              len={ring.r}
              w={ring.w}
              fill={ring.fill}
              vein={false}
            />
          ))}
        </g>
      ))}
      <circle cx={100} cy={148} r={7} fill={CREAM} />
    </>
  ),

  // 스투키: 곧게 선 원통형 잎
  snake: () => (
    <>
      <Pot />
      {[
        { x: 100, h: 138, w: 15, fill: GD },
        { x: 74, h: 104, w: 12, fill: G },
        { x: 126, h: 114, w: 12, fill: GL },
      ].map((s) => (
        <g key={s.x}>
          <path
            fill={s.fill}
            d={`M${s.x - s.w} 178 Q${s.x - s.w} ${178 - s.h} ${s.x} ${178 - s.h - 10} Q${s.x + s.w} ${178 - s.h} ${s.x + s.w} 178 Z`}
          />
          <path className="tn-vein" d={`M${s.x} 170 V${178 - s.h + 6}`} />
        </g>
      ))}
    </>
  ),

  // 파슬리: 곱슬거리는 잎 뭉치
  parsley: () => (
    <>
      <Pot />
      <path className="tn-stem" d="M100 178 V126" />
      <g transform="translate(100 106)">
        {[0, 51, 102, 153, 204, 255, 306].map((a) => {
          const r = (a * Math.PI) / 180;
          return <circle key={a} cx={Math.cos(r) * 26} cy={Math.sin(r) * 19} r={16} fill={a % 102 ? G : GL} />;
        })}
        <circle cx={0} cy={0} r={16} fill={GD} />
      </g>
    </>
  ),

  // 케일: 크게 주름진 잎
  kale: () => {
    const Ruffle = ({ x, y, s, rot }: { x: number; y: number; s: number; rot: number }) => (
      <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
        <path
          fill={GD}
          d="M0 0 C-20 -8 -38 -18 -40 -38 Q-30 -33 -28 -43 Q-18 -35 -18 -48 Q-8 -40 -5 -55 Q2 -43 8 -55 Q13 -38 20 -48 Q23 -35 33 -40 Q33 -22 18 -13 C10 -8 5 -3 0 0Z"
        />
        <path className="tn-vein" d="M0 -3 L-3 -43 M-3 -15 L-20 -30 M-3 -15 L15 -28" />
      </g>
    );
    return (
      <>
        <Pot />
        <path className="tn-stem" d="M100 178 V120" />
        <Ruffle x={76} y={158} s={0.72} rot={-30} />
        <Ruffle x={124} y={158} s={0.72} rot={30} />
        <Ruffle x={100} y={136} s={1.15} rot={0} />
      </>
    );
  },

  // 토마토: 톱니 잎과 붉은 열매
  tomato: () => {
    const Serrated = ({ x, y, rot, s }: { x: number; y: number; rot: number; s: number }) => (
      <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
        <path
          fill={G}
          d="M0 0 L12 -9 L7 -16 L19 -23 L13 -31 L25 -38 L17 -46 L28 -51 L14 -60 L0 -53 L-14 -60 L-28 -51 L-17 -46 L-25 -38 L-13 -31 L-19 -23 L-7 -16 L-12 -9 Z"
        />
        <path className="tn-vein" d="M0 -3 V-54" />
      </g>
    );
    return (
      <>
        <Pot />
        <path className="tn-stem" d="M100 178 V78" />
        <Serrated x={100} y={152} rot={-34} s={1} />
        <Serrated x={100} y={152} rot={34} s={1} />
        <Serrated x={100} y={100} rot={0} s={0.8} />
        <Berry x={76} y={140} r={17} fill={RED} />
        <Berry x={126} y={132} r={14} fill={RED} />
        <path className="tn-calyx" d="M76 123 l-7 -6 M76 123 l7 -6 M76 123 v-7 M126 118 l-6 -5 M126 118 l6 -5" />
      </>
    );
  },

  // 셀러리: 굵고 골이 진 줄기 다발
  celery: () => (
    <>
      <Pot />
      {[
        { x: 100, h: 124, w: 13 },
        { x: 76, h: 102, w: 11 },
        { x: 124, h: 106, w: 11 },
      ].map((s) => (
        <g key={s.x}>
          <path
            fill={GL}
            d={`M${s.x - s.w} 178 L${s.x - s.w + 3} ${178 - s.h} h${(s.w - 3) * 2} L${s.x + s.w} 178 Z`}
          />
          <path className="tn-vein" d={`M${s.x} 172 V${182 - s.h}`} />
          {[10, 80, 150].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <ellipse
                key={a}
                cx={s.x + Math.cos(r) * 13}
                cy={178 - s.h - 6 + Math.sin(r) * 6}
                rx={11}
                ry={7}
                fill={G}
              />
            );
          })}
        </g>
      ))}
    </>
  ),

  // 루꼴라: 깊게 갈라진 깃꼴 잎
  rocket: () => {
    const Lobed = ({ x, y, rot, s }: { x: number; y: number; rot: number; s: number }) => (
      <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
        <path
          fill={G}
          d="M0 0 C-17 -5 -22 -15 -15 -22 C-22 -27 -22 -37 -12 -41 C-19 -47 -17 -57 -7 -59 L0 -74 L7 -59 C17 -57 19 -47 12 -41 C22 -37 22 -27 15 -22 C22 -15 17 -5 0 0Z"
        />
        <path className="tn-vein" d="M0 -3 V-69" />
      </g>
    );
    return (
      <>
        <Pot />
        <path className="tn-stem" d="M100 178 C88 158 80 148 74 138 M100 178 V132" />
        <Lobed x={74} y={138} rot={-32} s={0.78} />
        <Lobed x={100} y={130} rot={4} s={1.05} />
      </>
    );
  },

  cactus: () => (
    <>
      <Pot />
      <path fill={G} d="M82 178 V114 Q82 94 100 94 Q118 94 118 114 V178 Z" />
      <path fill={GL} d="M82 150 Q62 150 62 132 Q62 116 71 116 Q78 116 78 128 V148 Z" />
      <path fill={GL} d="M118 138 Q138 138 138 120 Q138 104 129 104 Q122 104 122 116 V136 Z" />
      {[112, 128, 144, 160].map((y) => (
        <g key={y} className="tn-spine">
          <path d={`M82 ${y} l-7 -4`} />
          <path d={`M118 ${y} l7 -4`} />
          <path d={`M100 ${y} v-6`} />
        </g>
      ))}
      <circle cx={100} cy={92} r={8} fill={RED} />
    </>
  ),
};

const KEYWORD_FORMS: Record<string, PlantForm> = {
  바질: "basil",
  민트: "basil",
  제라늄: "basil",
  로즈마리: "rosemary",
  라벤더: "rosemary",
  레몬타임: "thyme",
  타임: "thyme",
  유칼립투스: "eucalyptus",
  라임오렌지나무: "citrus",
  라임오렌지: "citrus",
  오렌지나무: "citrus",
  레몬: "citrus",
  라임: "citrus",
  금귤: "citrus",
  오렌지자스민: "jasmine",
  자스민: "jasmine",
  치자: "jasmine",
  올리브: "olive",
  블루베리: "blueberry",
  베리: "blueberry",
  포도: "blueberry",
  고무나무: "ficus",
  벵갈: "ficus",
  떡갈: "ficus",
  알로카시아: "alocasia",
  몬스테라: "alocasia",
  스킨답서스: "alocasia",
  필로덴드론: "alocasia",
  여인초: "alocasia",
  아틀란티스: "rosette",
  다육: "rosette",
  세덤: "rosette",
  에케베리아: "rosette",
  스투키: "snake",
  산세베리아: "snake",
  알로에: "snake",
  파슬리: "parsley",
  고수: "parsley",
  케일: "kale",
  상추: "kale",
  깻잎: "kale",
  시금치: "kale",
  배추: "kale",
  토마토: "tomato",
  고추: "tomato",
  파프리카: "tomato",
  딸기: "tomato",
  가지: "tomato",
  셀러리: "celery",
  샐러리: "celery",
  대파: "celery",
  루꼴라: "rocket",
  루콜라: "rocket",
  치커리: "rocket",
  선인장: "cactus",
};

// 긴 이름부터 맞춰야 "레몬타임"이 "레몬"으로 안 간다.
const KEYWORDS = Object.keys(KEYWORD_FORMS).sort((a, b) => b.length - a.length);

const CATEGORY_FORMS: Record<string, PlantForm> = {
  허브: "basil",
  목본: "ficus",
  과수: "citrus",
  채소: "kale",
  엽채: "kale",
  다육: "rosette",
  세덤: "rosette",
  관엽: "alocasia",
  화훼: "basil",
};

/** 아는 이름이 아니어도 식물마다 다른 그림이 나오게 이름으로 고르게 섞는다. */
const FALLBACK: PlantForm[] = ["basil", "ficus", "alocasia", "kale", "rosette", "blueberry"];

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
 * 관리판에는 카드가 열댓 장 붙는다. 이름·분류가 같으면 그림도 같으므로 memo로 감싼다.
 * aria-hidden인 이유: 어느 자리에서든 바로 옆에 식물 이름이 글자로 있다.
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
  const Draw = FORMS[formFor(name, category)];
  return (
    <svg
      className={`plant-art${className ? ` ${className}` : ""}`}
      viewBox="0 0 200 240"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <Draw />
    </svg>
  );
});
