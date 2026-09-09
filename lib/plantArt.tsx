/**
 * 식물 그림. 굵은 외곽선 + 납작한 색의 만화풍.
 *
 * 앞서 두 번 실패했다. 처음엔 잎을 (각도·길이·폭) 함수로 찍어내 어느 식물이나
 * 비슷한 타원 잎 막대가 됐고, 다음엔 옛 도감 스캔을 걸었더니 책 여백·제본선·
 * 독일어 캡션에 한 장에 두 종까지 들어가 더 나빴다.
 *
 * 그래서 종마다 **알아보는 특징 하나**를 정해 그것만 크게, 하나만 그린다.
 *
 * 그리는 순서와 좌표 규칙 — 셋 다 "화분에 심겨 있다"로 보이게 하는 장치다.
 *  1. 식물을 먼저, 화분을 나중에 그린다. 그래야 밑동이 화분 뒤로 들어간다.
 *     (반대로 하면 줄기가 화분 테두리 위에 얹힌 그림이 된다)
 *  2. 줄기는 흙 속(y≈196)에서 시작한다. 화분 테두리 윗변이 y=164다.
 *  3. 열매와 꽃은 반드시 가지 끝이나 짧은 꼭지에 붙인다. 허공에 띄우지 않는다.
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

/** 흙 높이. 줄기는 이 아래에서 시작해 화분 뒤로 숨는다. */
const SOIL = 196;

/** 공통 화분. 식물을 다 그린 뒤 맨 위에 얹는다. */
const Pot = () => (
  <g>
    <path className="tn-pot" d="M64 178 H136 L129 226 Q128 232 122 232 H78 Q72 232 71 226 Z" />
    <path
      className="tn-pot-rim"
      d="M58 164 H142 Q146 164 146 168 V178 Q146 182 142 182 H58 Q54 182 54 178 V168 Q54 164 58 164 Z"
    />
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

/** 바늘잎 한 쌍. 잉크 밑선 위에 초록을 덧그어 윤곽선 안에 색이 보이게 한다. */
const Needles = ({ x, y, len = 13, rise = 10 }: { x: number; y: number; len?: number; rise?: number }) => (
  <g>
    <path className="tn-needle-ink" d={`M${x} ${y} L${x - len} ${y - rise}`} />
    <path className="tn-needle-ink" d={`M${x} ${y} L${x + len} ${y - rise}`} />
    <path className="tn-needle" d={`M${x} ${y} L${x - len} ${y - rise}`} />
    <path className="tn-needle" d={`M${x} ${y} L${x + len} ${y - rise}`} />
  </g>
);

/** 열매. 매단 가지에서 꼭지를 뽑아 붙인다(허공에 뜨지 않게). */
const Fruit = ({
  x,
  y,
  r,
  fill,
  from,
}: {
  x: number;
  y: number;
  r: number;
  fill: string;
  from: [number, number];
}) => (
  <g>
    <path className="tn-stalk" d={`M${from[0]} ${from[1]} Q${(from[0] + x) / 2} ${(from[1] + y) / 2 - 4} ${x} ${y - r}`} />
    <circle cx={x} cy={y} r={r} fill={fill} />
  </g>
);

const FORMS: Record<PlantForm, () => JSX.Element> = {
  // 바질: 통통한 달걀꼴 잎이 마주난다
  basil: () => (
    <>
      <path className="tn-stem" d={`M100 ${SOIL} V68`} />
      <Pair y={150} len={50} w={30} spread={16} />
      <Pair y={110} len={41} w={24} spread={22} fill={GL} />
      <Leaf x={100} y={76} deg={250} len={26} w={14} />
      <Leaf x={100} y={76} deg={290} len={26} w={14} />
    </>
  ),

  // 로즈마리: 바늘잎이 빽빽한 곧은 가지
  rosemary: () => (
    <>
      {[
        { d: `M100 ${SOIL} C97 150 101 110 100 66`, x: 100, drift: 0, n: 7, top: 66 },
        { d: `M100 ${SOIL} C88 154 78 126 72 100`, x: 100, drift: -28, n: 5, top: 100 },
        { d: `M100 ${SOIL} C112 154 122 130 128 108`, x: 100, drift: 28, n: 5, top: 108 },
      ].map((s) => (
        <g key={s.d}>
          <path className="tn-stem" d={s.d} />
          {Array.from({ length: s.n }, (_, i) => {
            const t = (i + 1) / (s.n + 1);
            const y = 172 - (172 - s.top) * t;
            const x = s.x + s.drift * t * t;
            return (
              <Needles key={i} x={x} y={y} />
            );
          })}
        </g>
      ))}
      <circle cx={100} cy={60} r={5} fill={SILVER} />
    </>
  ),

  // 레몬타임: 아주 작은 잎이 낮게 뭉쳐 퍼진다
  thyme: () => (
    <>
      {[-1, 1].map((dir) =>
        [0, 1].map((row) => {
          const reach = 40 - row * 12;
          const lift = 34 + row * 20;
          return (
            <g key={`${dir}-${row}`}>
              <path
                className="tn-stem"
                d={`M100 ${SOIL} C${100 + reach * 0.5 * dir} ${186 - lift * 0.4} ${100 + reach * dir} ${180 - lift * 0.8} ${100 + reach * dir} ${180 - lift}`}
              />
              {Array.from({ length: 4 }, (_, i) => {
                const t = (i + 1) / 4.3;
                const x = 100 + reach * dir * t;
                const y = 184 - lift * t - 6;
                return (
                  <g key={i}>
                    <ellipse cx={x - 7} cy={y} rx={7} ry={5.2} fill={i % 2 ? GL : G} />
                    <ellipse cx={x + 7} cy={y + 4} rx={7} ry={5.2} fill={i % 2 ? G : GL} />
                  </g>
                );
              })}
            </g>
          );
        }),
      )}
    </>
  ),

  // 유칼립투스: 줄기를 감싸듯 마주나는 둥근 은청색 잎
  eucalyptus: () => (
    <>
      <path className="tn-stem" d={`M100 ${SOIL} V48`} />
      {[
        { y: 152, r: 24 },
        { y: 116, r: 21 },
        { y: 84, r: 17 },
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

  // 감귤: 가지 끝에 매달린 주황 열매
  citrus: () => (
    <>
      <path className="tn-trunk" d={`M100 ${SOIL} V112`} />
      <path className="tn-stem" d="M100 126 L74 104 M100 126 L126 104" />
      <Leaf x={74} y={104} deg={202} len={40} w={20} fill={GD} />
      <Leaf x={126} y={104} deg={-22} len={40} w={20} fill={GD} />
      <Leaf x={100} y={112} deg={248} len={38} w={19} fill={G} />
      <Leaf x={100} y={112} deg={292} len={38} w={19} fill={G} />
      <Fruit x={78} y={140} r={17} fill={ORANGE} from={[88, 116]} />
      <Fruit x={124} y={134} r={14} fill={ORANGE} from={[114, 114]} />
    </>
  ),

  // 오렌지자스민: 가지 끝에 피는 흰 꽃
  jasmine: () => (
    <>
      <path className="tn-trunk" d={`M100 ${SOIL} V118`} />
      <path className="tn-stem" d="M100 132 L76 114 M100 132 L124 114 M100 124 V96" />
      <Leaf x={76} y={114} deg={206} len={28} w={13} fill={GD} />
      <Leaf x={124} y={114} deg={-26} len={28} w={13} fill={GD} />
      <Leaf x={100} y={126} deg={246} len={26} w={12} fill={G} />
      <Leaf x={100} y={126} deg={294} len={26} w={12} fill={G} />
      {[
        { cx: 76, cy: 110, s: 0.8 },
        { cx: 124, cy: 110, s: 0.8 },
        { cx: 100, cy: 92, s: 1 },
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

  // 올리브: 좁고 긴 은회색 잎, 가지에 달린 열매
  olive: () => (
    <>
      <path className="tn-trunk" d={`M100 ${SOIL} C96 158 104 140 100 112`} />
      <path className="tn-stem" d="M100 128 L72 110 M100 128 L128 110" />
      <Leaf x={72} y={110} deg={198} len={38} w={10} fill={SILVER} />
      <Leaf x={72} y={110} deg={246} len={32} w={9} fill={GD} />
      <Leaf x={128} y={110} deg={-18} len={38} w={10} fill={SILVER} />
      <Leaf x={128} y={110} deg={-66} len={32} w={9} fill={GD} />
      <Leaf x={100} y={112} deg={244} len={36} w={10} fill={GD} />
      <Leaf x={100} y={112} deg={296} len={36} w={10} fill={SILVER} />
      <Leaf x={100} y={112} deg={270} len={32} w={9} fill={GD} />
      <Fruit x={86} y={140} r={8} fill={OLIVE} from={[94, 124]} />
      <Fruit x={116} y={136} r={7} fill={OLIVE} from={[108, 122]} />
    </>
  ),

  // 블루베리: 가지에 매달린 청보라 열매 송이
  blueberry: () => (
    <>
      <path className="tn-stem" d={`M100 ${SOIL} C96 152 100 126 100 92`} />
      <path className="tn-stem" d="M100 148 L74 128 M100 128 L126 112" />
      <Leaf x={74} y={128} deg={200} len={30} w={14} fill={GD} />
      <Leaf x={126} y={112} deg={-20} len={30} w={14} fill={G} />
      <Leaf x={100} y={96} deg={246} len={28} w={13} fill={G} />
      <Leaf x={100} y={96} deg={294} len={28} w={13} fill={GD} />
      {[
        { x: 74, y: 140, r: 10, from: [80, 126] as [number, number] },
        { x: 96, y: 148, r: 9, from: [94, 132] as [number, number] },
        { x: 124, y: 128, r: 9, from: [120, 114] as [number, number] },
      ].map((b) => (
        <g key={b.x}>
          <Fruit x={b.x} y={b.y} r={b.r} fill={BLUE} from={b.from} />
          <circle cx={b.x - b.r * 0.3} cy={b.y - b.r * 0.35} r={b.r * 0.24} fill={WHITE} opacity={0.8} />
        </g>
      ))}
    </>
  ),

  // 고무나무: 두껍고 큰 광택 잎, 붉은 새순
  ficus: () => (
    <>
      <path className="tn-trunk" d={`M100 ${SOIL} V62`} />
      <Leaf x={100} y={160} deg={198} len={54} w={28} fill={GD} />
      <Leaf x={100} y={138} deg={-18} len={54} w={28} fill={G} />
      <Leaf x={100} y={114} deg={202} len={46} w={24} fill={G} />
      <Leaf x={100} y={92} deg={-22} len={46} w={24} fill={GD} />
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
        {/* 잎자루 둘. 각 잎은 자기 잎자루 끝에 정확히 얹힌다. */}
        <path className="tn-stem" d={`M100 ${SOIL} C99 160 100 130 100 106`} />
        <path className="tn-stem" d={`M100 ${SOIL} C112 168 126 150 134 134`} />
        <Arrow x={134} y={134} s={0.42} rot={30} />
        <Arrow x={100} y={106} s={0.82} rot={-4} />
      </>
    );
  },

  // 다육 로제트: 크림색이 든 통통한 잎
  rosette: () => (
    <>
      {[
        { r: 48, w: 17, n: 8, fill: G, off: 0 },
        { r: 33, w: 13, n: 6, fill: GL, off: 30 },
        { r: 19, w: 10, n: 5, fill: CREAM, off: 12 },
      ].map((ring) => (
        <g key={ring.r}>
          {Array.from({ length: ring.n }, (_, i) => (
            <Leaf
              key={i}
              x={100}
              y={146}
              deg={ring.off + (360 / ring.n) * i}
              len={ring.r}
              w={ring.w}
              fill={ring.fill}
              vein={false}
            />
          ))}
        </g>
      ))}
      <circle cx={100} cy={146} r={7} fill={CREAM} />
    </>
  ),

  // 스투키: 곧게 선 원통형 잎
  snake: () => (
    <>
      {[
        { x: 100, h: 142, w: 15, fill: GD },
        { x: 74, h: 106, w: 12, fill: G },
        { x: 126, h: 116, w: 12, fill: GL },
      ].map((s) => (
        <g key={s.x}>
          <path
            fill={s.fill}
            d={`M${s.x - s.w} ${SOIL} Q${s.x - s.w} ${190 - s.h} ${s.x} ${180 - s.h} Q${s.x + s.w} ${190 - s.h} ${s.x + s.w} ${SOIL} Z`}
          />
          <path className="tn-vein" d={`M${s.x} 186 V${188 - s.h}`} />
        </g>
      ))}
    </>
  ),

  // 파슬리: 곱슬거리는 잎 뭉치
  parsley: () => (
    <>
      <path className="tn-stem" d={`M100 ${SOIL} V124`} />
      <g transform="translate(100 108)">
        {[0, 51, 102, 153, 204, 255, 306].map((a) => {
          const r = (a * Math.PI) / 180;
          return <circle key={a} cx={Math.cos(r) * 26} cy={Math.sin(r) * 19} r={16} fill={a % 102 ? G : GL} />;
        })}
        <circle cx={0} cy={0} r={16} fill={GD} />
      </g>
    </>
  ),

  // 케일: 크게 주름진 잎. 서로 겹치지 않게 벌려 세운다.
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
        <path className="tn-stem" d={`M100 ${SOIL} V154 M100 ${SOIL} L62 180 M100 ${SOIL} L138 180`} />
        <Ruffle x={62} y={180} s={0.62} rot={-52} />
        <Ruffle x={138} y={180} s={0.62} rot={52} />
        <Ruffle x={100} y={158} s={0.95} rot={0} />
      </>
    );
  },

  // 토마토: 톱니 잎과 가지에 달린 붉은 열매
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
        <path className="tn-stem" d={`M100 ${SOIL} V72`} />
        <Serrated x={100} y={168} rot={-52} s={0.8} />
        <Serrated x={100} y={168} rot={52} s={0.8} />
        <Serrated x={100} y={116} rot={-30} s={0.72} />
        <Serrated x={100} y={116} rot={30} s={0.72} />
        <Serrated x={100} y={78} rot={0} s={0.62} />
        <Fruit x={74} y={126} r={15} fill={RED} from={[96, 108]} />
        <Fruit x={128} y={134} r={12} fill={RED} from={[100, 118]} />
      </>
    );
  },

  // 셀러리: 굵고 골이 진 줄기 다발
  celery: () => (
    <>
      {[
        { x: 100, h: 128, w: 13 },
        { x: 76, h: 104, w: 11 },
        { x: 124, h: 108, w: 11 },
      ].map((s) => (
        <g key={s.x}>
          <path
            fill={GL}
            d={`M${s.x - s.w} ${SOIL} L${s.x - s.w + 3} ${186 - s.h} h${(s.w - 3) * 2} L${s.x + s.w} ${SOIL} Z`}
          />
          <path className="tn-vein" d={`M${s.x} 190 V${190 - s.h}`} />
          {[10, 80, 150].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <ellipse
                key={a}
                cx={s.x + Math.cos(r) * 13}
                cy={186 - s.h - 6 + Math.sin(r) * 6}
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
        <path className="tn-stem" d={`M100 ${SOIL} C90 172 80 164 72 156 M100 ${SOIL} V150 M100 ${SOIL} C112 172 122 166 130 158`} />
        <Lobed x={72} y={156} rot={-38} s={0.7} />
        <Lobed x={130} y={158} rot={38} s={0.7} />
        <Lobed x={100} y={150} rot={0} s={0.95} />
      </>
    );
  },

  cactus: () => (
    <>
      <path fill={G} d={`M82 ${SOIL} V114 Q82 94 100 94 Q118 94 118 114 V${SOIL} Z`} />
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
 *
 * 식물만 tn-plant로 묶는다. 바람에 흔들리는 시늉은 이 그룹에만 걸어,
 * 화분까지 같이 흔들리지 않게 한다.
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
      <g className="tn-plant">
        <Draw />
      </g>
      <Pot />
    </svg>
  );
});
