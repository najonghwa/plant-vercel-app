"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Camera,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  Gauge,
  Home,
  Leaf,
  Plus,
  RefreshCw,
  Settings,
  Sprout,
  StickyNote,
  ThermometerSun,
  Trash2,
  X,
} from "lucide-react";
import type { DayMemo, Plant, PlantPhoto, SensorReading, WateringLog } from "@/lib/types";
import { latinNameFor } from "@/lib/latinNames";
import { PlantArt } from "@/lib/plantArt";
import { noteFor } from "@/lib/plantNotes";

type PlantModel = Plant & {
  logs: WateringLog[];
  lastWatered: string | null;
  interval: number;
  baseInterval: number;
  learnedInterval: number | null;
  environmentAdjustment: number;
  recommendationReasons: string[];
  nextDue: string | null;
  dday: number | null;
};

const blankPlant = {
  name: "",
  location: "거실",
};

/** 이 시간이 지난 센서값은 "현재 환경"으로 신뢰하지 않는다. */
const SENSOR_STALE_HOURS = 6;

/** db/schema.sql의 check 제약과 반드시 같아야 한다. 벗어난 값은 저장 시 500이 난다. */
const MOISTURE_RANGE = [1, 100] as const;
const SECONDS_RANGE = [1, 15] as const;
const COOLDOWN_RANGE = [1, 168] as const;
const MAX_RUNS_RANGE = [1, 12] as const;

function sensorAgeHours(reading: SensorReading | undefined, nowMs: number) {
  if (!reading) return null;
  const recorded = new Date(reading.recorded_at).getTime();
  if (!Number.isFinite(recorded)) return null;
  return (nowMs - recorded) / 3600000;
}

function isFresh(reading: SensorReading | undefined, nowMs: number) {
  const age = sensorAgeHours(reading, nowMs);
  return age !== null && age <= SENSOR_STALE_HOURS;
}

function formatAge(hours: number) {
  if (hours < 1) return "방금";
  if (hours < 24) return `${Math.floor(hours)}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 서버가 주는 recorded_at은 UTC의 ISO 문자열이라 앞 16자를 그대로 보이면 9시간 빠르다.
 * 보는 사람의 시계로 바꿔 "2026-09-08 00:14" 꼴로 적는다.
 */
function localStamp(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 헤더에 적는 오늘. "9월 8일 화요일" 꼴. */
function koreanDate(value: string) {
  const d = toDate(value);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

/** 카드처럼 좁은 칸에서 쓰는 "09 · 01" 꼴. 연도는 툴팁으로만 남긴다. */
function shortDate(value: string) {
  return value.slice(5, 10).replace("-", " · ");
}

/** 기록 목록 정렬 기준. 서버 응답과 같아야 새 기록이 엉뚱한 자리에 끼지 않는다. */
function sortEntries(list: PlantPhoto[]) {
  return [...list].sort(
    (a, b) =>
      b.captured_at.localeCompare(a.captured_at) ||
      String(b.created_at).localeCompare(String(a.created_at)),
  );
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function dateDiff(a: string, b: string) {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000);
}

function addDays(dateString: string, days: number) {
  const d = toDate(dateString);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/**
 * 평균은 이상치 하나에 통째로 끌려간다. 급수 간격은 "깜빡 잊고 한 달 만에 준 날" 같은
 * 값이 섞이기 쉬워서 중앙값이 실제 습관에 훨씬 가깝다.
 */
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 이만큼은 쌓여야 "습관"이라고 볼 수 있다. 간격 1개짜리는 우연에 가깝다. */
const MIN_GAPS_FOR_LEARNING = 2;

/** 서버 상태를 바꾸지 않는 run() 키. 조회 결과를 무효화하는 카운터를 올리면 안 된다. */
const READ_ONLY_KEYS = /^(photos$|photo-open:|photo-prepare$|entries:|entry-prepare$)/;

function estimateBaseInterval(waterLevel: string) {
  if (waterLevel === "매우 적게") return 21;
  if (waterLevel === "적게") return 14;
  if (waterLevel === "적게~보통") return 10;
  if (waterLevel === "자주") return 4;
  if (waterLevel === "보통~자주") return 5;
  return 7;
}

function getSeason(dateString: string) {
  const month = Number(dateString.slice(5, 7));
  if ([12, 1, 2].includes(month)) return "winter";
  if ([6, 7, 8].includes(month)) return "summer";
  if ([3, 4, 5].includes(month)) return "spring";
  return "fall";
}

function environmentAdjustmentFor(
  plant: Plant,
  environmentReading: SensorReading | undefined,
  soilReading: SensorReading | undefined,
  today: string,
  /** 학습 주기가 없어 기본 주기를 쓸 때만 물 선호도 보정을 추가로 적용한다. */
  applyWaterPreference: boolean,
) {
  let adjustment = 0;
  const reasons: string[] = [];
  const season = getSeason(today);

  if (season === "summer") {
    adjustment -= 1;
    reasons.push("여름이라 증산량을 반영해 주기를 당김");
  } else if (season === "winter") {
    adjustment += 2;
    reasons.push("겨울이라 생장 둔화를 반영해 주기를 늦춤");
  }

  if (environmentReading) {
    if (environmentReading.temperature_c >= 28) {
      adjustment -= 1;
      reasons.push(`온도 ${environmentReading.temperature_c}°C로 높아 건조 속도 가산`);
    } else if (environmentReading.temperature_c <= 16) {
      adjustment += 1;
      reasons.push(`온도 ${environmentReading.temperature_c}°C로 낮아 과습 위험 반영`);
    }

    if (environmentReading.humidity_pct <= 40) {
      adjustment -= 1;
      reasons.push(`습도 ${environmentReading.humidity_pct}%로 낮아 수분 소모 가산`);
    } else if (environmentReading.humidity_pct >= 75) {
      adjustment += 1;
      reasons.push(`습도 ${environmentReading.humidity_pct}%로 높아 마름 속도 완화`);
    }

    // 조도는 순간값이라 밤에 재면 항상 어둡다. 예전에는 밤마다 "빛이 적다"며 주기를
    // 늦춰, 같은 날에도 낮과 밤에 상태가 뒤집혔다. 밝을 때만 가산하고 어둡다고 빼지 않는다.
    if (environmentReading.light_lux >= 900) {
      adjustment -= 1;
      reasons.push(`조도 ${environmentReading.light_lux}lx로 높아 증산량 가산`);
    }
  } else {
    reasons.push(
      `최근 ${SENSOR_STALE_HOURS}시간 안에 들어온 구역 온습도/조도 값이 없어 기록 기반 주기를 사용`,
    );
  }

  // 토양센서를 떼면 기기가 0을 보내는 경우가 있는데, 그걸 "완전히 말랐다"로 읽으면
  // 멀쩡한 식물이 계속 긴급으로 뜬다. 실측이 있을 때만 반영한다.
  const soilMoisture = soilReading?.soil_moisture_pct ?? null;
  if (soilMoisture !== null) {
    if (soilMoisture <= 28) {
      adjustment -= 2;
      reasons.push(`연결 토양수분 ${soilMoisture}%로 낮아 우선 확인 권장`);
    } else if (soilMoisture >= 65) {
      adjustment += 2;
      reasons.push(`연결 토양수분 ${soilMoisture}%로 높아 과습 주의`);
    }
  } else {
    reasons.push("토양수분 실측값이 없어 환경/기록 기반으로 판단");
  }

  if (applyWaterPreference) {
    const level = plant.water_level ?? "";
    // "적게~보통", "보통~자주" 같은 복합 값은 이미 기본 주기에 반영돼 있어 제외한다.
    if (level === "자주") {
      adjustment -= 1;
      reasons.push("식물 물 요구가 높은 편");
    } else if (level === "적게" || level === "매우 적게") {
      adjustment += 1;
      reasons.push("식물 물 요구가 낮은 편");
    }
  }

  return { adjustment, reasons };
}

/** 같은 키에 여러 건이 오면 recorded_at이 가장 최신인 값만 남긴다. */
function latestBy(readings: SensorReading[], keyOf: (reading: SensorReading) => string) {
  return readings.reduce<Record<string, SensorReading>>((acc, reading) => {
    const key = keyOf(reading);
    const current = acc[key];
    if (!current || new Date(reading.recorded_at) > new Date(current.recorded_at)) {
      acc[key] = reading;
    }
    return acc;
  }, {});
}

function buildPlantModel(
  plants: Plant[],
  logs: WateringLog[],
  readings: SensorReading[],
  today: string,
  nowMs: number,
) {
  const byPlant = logs.reduce<Record<string, WateringLog[]>>((acc, log) => {
    acc[log.plant_name] = [...(acc[log.plant_name] ?? []), log];
    return acc;
  }, {});
  const readingByLocation = latestBy(readings, (reading) => reading.location);
  const readingByDevice = latestBy(readings, (reading) => reading.device_id);

  return plants.map<PlantModel>((plant) => {
    const plantLogs = (byPlant[plant.name] ?? []).sort((a, b) =>
      a.watered_at.localeCompare(b.watered_at),
    );
    // 미래 날짜로 잘못 적힌 기록이 "마지막 급수"가 되면 다음 예정일이 앞으로 밀려
    // 알림이 통째로 사라지고, 간격 계산까지 오염된다. 지난 기록만 쓴다.
    const dates = plantLogs
      .map((log) => log.watered_at.slice(0, 10))
      .filter((date) => date <= today);
    const gaps = dates
      .slice(1)
      .map((date, index) => dateDiff(date, dates[index]))
      .filter((gap) => gap > 0);

    const defaultInterval = estimateBaseInterval(plant.water_level);
    const recentGaps = gaps.slice(-6);
    const learnedRaw = recentGaps.length >= MIN_GAPS_FOR_LEARNING ? median(recentGaps) : null;
    // 학습값이라도 식물의 기본 요구량에서 지나치게 벗어나면 그대로 믿지 않는다.
    // (한 번 오래 방치한 기록 때문에 "27일마다 주면 된다"가 되던 문제)
    const learnedInterval =
      learnedRaw === null
        ? null
        : Math.round(
            Math.min(defaultInterval * 2, Math.max(defaultInterval / 2, learnedRaw)),
          );
    const baseInterval = learnedInterval ?? defaultInterval;
    // 오래된 센서값은 "지금 환경"이 아니므로 주기 계산에서 제외한다.
    const environmentCandidate = readingByLocation[plant.location];
    const environmentReading = isFresh(environmentCandidate, nowMs) ? environmentCandidate : undefined;
    const soilCandidate =
      plant.soil_sensor_enabled && plant.soil_sensor_device_id
        ? readingByDevice[plant.soil_sensor_device_id]
        : undefined;
    const soilReading = isFresh(soilCandidate, nowMs) ? soilCandidate : undefined;
    const environment = environmentAdjustmentFor(
      plant,
      environmentReading,
      soilReading,
      today,
      learnedInterval === null,
    );
    const interval = Math.max(2, Math.min(30, baseInterval + environment.adjustment));
    const lastWatered = dates.at(-1) ?? null;
    const nextDue = lastWatered ? addDays(lastWatered, interval) : null;
    const recommendationReasons = [
      learnedInterval
        ? `최근 급수 간격 중앙값 ${learnedInterval}일을 반영(기록 ${recentGaps.length}구간)`
        : `기록이 ${MIN_GAPS_FOR_LEARNING}구간에 못 미쳐 기본 주기 ${defaultInterval}일을 사용`,
      ...environment.reasons,
    ];

    return {
      ...plant,
      logs: plantLogs,
      lastWatered,
      interval,
      baseInterval,
      learnedInterval,
      environmentAdjustment: environment.adjustment,
      recommendationReasons,
      nextDue,
      dday: nextDue ? dateDiff(nextDue, today) : null,
    };
  });
}

/**
 * 남은 날을 부호 붙인 숫자로 준다. -1은 하루 늦음, +0은 오늘, +3은 사흘 남음.
 * 낱말("곧 물주기")보다 짧고, 카드마다 폭이 흔들리지 않는다.
 */
function statusFor(dday: number | null) {
  if (dday === null) return { label: "—", className: "ok", full: "급수 기록 없음" };
  if (dday < 0) return { label: String(dday), className: "late", full: `${Math.abs(dday)}일 지났습니다` };
  if (dday === 0) return { label: "+0", className: "soon", full: "오늘 줄 차례입니다" };
  if (dday <= 2) return { label: `+${dday}`, className: "soon", full: `${dday}일 남았습니다` };
  return { label: `+${dday}`, className: "ok", full: `${dday}일 남았습니다` };
}

function listPlantNames(plants: PlantModel[]) {
  if (!plants.length) return "없음";
  return plants.map((plant) => plant.name).join(", ");
}

function wateringGaps(logs: WateringLog[]) {
  const dates = logs.map((log) => log.watered_at.slice(0, 10));
  return dates
    .slice(1)
    .map((date, index) => ({ date, gap: dateDiff(date, dates[index]) }))
    .filter((item) => item.gap > 0);
}

function getMonthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: formatLocalDate(day),
      inMonth: day.getMonth() === monthNumber - 1,
    };
  });
}

function moveMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/* ── 사진 업로드 ─────────────────────────────────────────────
   전용 스토리지를 두지 않고 data URL로 저장하므로, 원본을 그대로 올리면
   폰 사진 한 장이 수 MB가 된다. 브라우저에서 미리 줄여서 보낸다. */

const PHOTO_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** 서버의 MAX_IMAGE_CHARS와 맞춘다. 넘으면 화질을 한 단계씩 낮춰 다시 만든다. */
const PHOTO_MAX_CHARS = 3_000_000;
const PHOTO_STEPS = [
  { maxSide: 1280, quality: 0.78 },
  { maxSide: 1024, quality: 0.62 },
  { maxSide: 800, quality: 0.5 },
];

type PhotoSource = ImageBitmap | HTMLImageElement;

async function loadImageSource(file: File): Promise<PhotoSource> {
  if (typeof createImageBitmap === "function") {
    try {
      // 세로로 찍은 사진이 눕지 않도록 EXIF 회전을 반영해서 디코딩한다.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // 옵션을 지원하지 않는 브라우저는 아래 <img> 경로로 넘어간다.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return image;
}

function drawToDataUrl(source: PhotoSource, maxSide: number, quality: number) {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이 브라우저에서는 사진을 변환할 수 없습니다.");

  // JPEG에는 투명도가 없어서 PNG를 그대로 그리면 투명한 부분이 검게 된다.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

async function preparePhoto(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 올릴 수 있습니다.");
  }
  if (file.size > PHOTO_MAX_FILE_BYTES) {
    throw new Error("사진이 너무 큽니다. 25MB 이하 파일을 골라주세요.");
  }

  const source = await loadImageSource(file);
  try {
    let image = "";
    for (const step of PHOTO_STEPS) {
      image = drawToDataUrl(source, step.maxSide, step.quality);
      if (image.length <= PHOTO_MAX_CHARS) break;
    }
    if (image.length > PHOTO_MAX_CHARS) {
      throw new Error("사진을 충분히 줄이지 못했습니다. 다른 사진으로 시도해주세요.");
    }
    return { image, thumb: drawToDataUrl(source, 360, 0.6) };
  } finally {
    if (typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${url} 요청 실패`);
  }

  return response.json();
}

export default function Page() {
  // 탭을 켜둔 채 자정을 넘겨도 D-day가 그대로 남던 문제 때문에 주기적으로 갱신한다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 시계에 매인 글자는 브라우저에 붙은 뒤에만 그린다. 서버 시계(UTC)로 먼저 그리면
  // 한국 시각 자정부터 아침 9시까지 어제 날짜가 잠깐 보이고 React가 불일치를 경고한다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const today = useMemo(() => formatLocalDate(new Date(nowMs)), [nowMs]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [logs, setLogs] = useState<WateringLog[]>([]);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [memos, setMemos] = useState<DayMemo[]>([]);
  const [photos, setPhotos] = useState<PlantPhoto[]>([]);
  // 식물 분석에서 보는 그 식물만의 기록. 전체 갤러리(photos)와 따로 둔다.
  const [entries, setEntries] = useState<PlantPhoto[]>([]);
  const [entriesPlantId, setEntriesPlantId] = useState("");
  const [entryDraft, setEntryDraft] = useState({ note: "", capturedAt: "" });
  const [pendingEntryPhoto, setPendingEntryPhoto] = useState<{ image: string; thumb: string; name: string } | null>(null);
  const entryInputRef = useRef<HTMLInputElement>(null);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [photosError, setPhotosError] = useState("");
  // 대시보드에서 '물주기'를 누를 때 기록될 날짜. 기본은 오늘이고, 어제 준 것을
  // 뒤늦게 기록할 때 캘린더 탭까지 들어가지 않아도 되게 한다.
  // 캘린더의 selectedDate와는 따로 둔다. 같이 쓰면 한쪽을 바꿀 때 다른 쪽이 끌려간다.
  const [waterDate, setWaterDate] = useState(today);
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "status" | "analysis" | "calendar" | "photos" | "water" | "add"
  >("dashboard");
  const [selectedPlantId, setSelectedPlantId] = useState("");
  const [settingsPlantId, setSettingsPlantId] = useState<string | null>(null);
  const [newPlant, setNewPlant] = useState(blankPlant);
  const [bulkLog, setBulkLog] = useState({ plant_names: [] as string[], memo: "" });
  // 촬영일은 캘린더의 selectedDate와 분리해야 한다. 같이 쓰면 사진 촬영일을 바꾼 뒤
  // 캘린더에서 남기는 급수 기록까지 그 날짜로 저장된다.
  const [photoDraft, setPhotoDraft] = useState({ plantId: "", note: "", capturedAt: "" });
  const [pendingPhoto, setPendingPhoto] = useState<{ image: string; thumb: string; name: string } | null>(null);
  const [lightbox, setLightbox] = useState<
    { photo: PlantPhoto; imageUrl: string | null; status: "loading" | "ready" | "error" } | null
  >(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const plateInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const inFlightKeys = useRef<Set<string>>(new Set());
  const loadSeq = useRef(0);
  const photoSeq = useRef(0);
  const mutationCount = useRef(0);

  /**
   * 변경 API는 실패해도 화면에 아무 반응이 없어서 사용자가 성공한 줄 알던 문제가 있었다.
   * 모든 변경 동작을 이 래퍼로 감싸 에러를 표시하고, 같은 키의 중복 실행(연타)을 막는다.
   */
  async function run(key: string, action: () => Promise<void>) {
    // 상태로만 막으면 같은 tick에 들어온 두 번째 클릭이 재렌더 전이라 그대로 통과한다.
    // 실제 차단은 동기적으로 갱신되는 ref로 하고, 상태는 버튼 비활성화 표시용으로만 쓴다.
    if (inFlightKeys.current.has(key)) return;
    inFlightKeys.current.add(key);
    setBusyKeys((prev) => [...prev, key]);
    setError("");
    try {
      await action();
      // 진행 중이던 전체 조회가 이 변경 이전 상태로 화면을 되돌리지 않게 표시해 둔다.
      // 서버 상태를 바꾸지 않는 동작(조회·이미지 축소)은 세지 않는다. 세면 사진을
      // 크게 보기만 해도 진행 중이던 새로고침 결과가 통째로 버려진다.
      if (!READ_ONLY_KEYS.test(key)) mutationCount.current += 1;
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청을 처리하지 못했습니다.");
    } finally {
      inFlightKeys.current.delete(key);
      setBusyKeys((prev) => prev.filter((item) => item !== key));
    }
  }

  const isBusy = (key: string) => busyKeys.includes(key);

  async function loadAll() {
    // 불러오는 도중에 물주기 같은 변경이 끝나면, 뒤늦게 도착한 예전 응답이 그 결과를
    // 덮어써 방금 남긴 기록이 화면에서 사라졌다.
    // 최신 요청이 아니거나, 그 사이에 변경이 있었으면 응답을 반영하지 않는다.
    const seq = ++loadSeq.current;
    const mutationsAtStart = mutationCount.current;
    setError("");
    setLoading(true);

    try {
      const [plantsData, logsData, sensorData, memoData] = await Promise.all([
        fetchJson<{ plants: Plant[] }>("/api/plants"),
        fetchJson<{ logs: WateringLog[] }>("/api/watering-logs"),
        fetchJson<{ readings: SensorReading[] }>("/api/sensor-readings"),
        fetchJson<{ memos: DayMemo[] }>("/api/day-memos"),
      ]);
      if (seq !== loadSeq.current || mutationsAtStart !== mutationCount.current) return;

      setPlants(plantsData.plants);
      setLogs(logsData.logs);
      setReadings(sensorData.readings);
      setMemos(memoData.memos);

      // 사진 탭을 이미 본 적이 있으면 사진도 같이 최신으로 맞춘다.
      if (photosLoaded) await loadPhotos();
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : "데이터를 불러오지 못했습니다.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  /**
   * 사진 목록을 다시 불러온다. 실패를 별도 상태로 남겨야 "사진이 없음"과
   * "불러오지 못함"이 화면에서 구분된다. 재시도 실패도 같은 경로를 타야 하므로
   * 에러 처리를 호출부가 아니라 여기 한 곳에 둔다.
   */
  function reloadPhotos() {
    return run("photos", async () => {
      setPhotosError("");
      try {
        await loadPhotos();
      } catch (error) {
        setPhotosError(error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
        throw error;
      }
    });
  }

  async function loadPhotos() {
    // 목록 조회가 늦게 도착해 그 사이의 업로드·삭제를 되돌리지 않게 막는다.
    const seq = ++photoSeq.current;
    const mutationsAtStart = mutationCount.current;
    const wasLoaded = photosLoaded;
    const data = await fetchJson<{ photos: PlantPhoto[] }>("/api/plant-photos");

    if (seq !== photoSeq.current) return;
    // 아직 한 번도 못 불러온 상태라면 덮어쓸 로컬 데이터가 없다. 여기서 그냥 반환하면
    // photosLoaded가 영영 false로 남아 사진 탭이 빈 화면에 고착된다.
    if (wasLoaded && mutationsAtStart !== mutationCount.current) return;

    setPhotos(data.photos);
    setPhotosLoaded(true);
    setPhotosError("");
  }

  useEffect(() => {
    loadAll();
  }, []);

  // 사진 목록은 썸네일이라도 무거우므로 사진 탭을 처음 열 때만 가져온다.
  useEffect(() => {
    if (activeTab !== "photos" || photosLoaded) return;
    reloadPhotos();
  }, [activeTab, photosLoaded]);

  // 촬영일 기본값은 오늘. 사용자가 직접 고른 날짜는 유지하되, 우리가 자동으로 넣은
  // 값이라면 날짜가 바뀔 때 따라가야 한다. 안 그러면 자정을 넘긴 뒤 올린 사진이
  // 어제 날짜로 저장된다.
  const autoCapturedAt = useRef("");
  useEffect(() => {
    if (activeTab !== "photos") return;
    setPhotoDraft((prev) => {
      if (prev.capturedAt && prev.capturedAt !== autoCapturedAt.current) return prev;
      autoCapturedAt.current = today;
      return { ...prev, capturedAt: today };
    });
  }, [activeTab, today]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // 탭을 켜둔 채 자정을 넘기면 '오늘'이 바뀐다. 사용자가 다른 날짜를 직접 고른 게
  // 아니라면 선택 날짜도 같이 넘겨야, 새 기록이 전날 날짜로 저장되지 않는다.
  const previousToday = useRef(today);
  useEffect(() => {
    const before = previousToday.current;
    if (before === today) return;
    previousToday.current = today;

    setSelectedDate((prev) => (prev === before ? today : prev));
    setWaterDate((prev) => (prev === before ? today : prev));
    setCalendarMonth((prev) => (prev === before.slice(0, 7) ? today.slice(0, 7) : prev));
  }, [today]);

  // 겹쳐 뜨는 창(설정 모달, 사진 크게보기)은 Esc로 닫고, 뒤 페이지가 같이 스크롤되지 않게 막는다.
  const overlayOpen = Boolean(settingsPlantId) || Boolean(lightbox);

  useEffect(() => {
    if (!overlayOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 사진을 설정 모달 위에서 열 수도 있으므로 위에 있는 것부터 닫는다.
      setLightbox((prev) => {
        if (prev) return null;
        setSettingsPlantId(null);
        return prev;
      });
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [overlayOpen]);

  const model = useMemo(
    () => buildPlantModel(plants, logs, readings, today, nowMs),
    [plants, logs, readings, today, nowMs],
  );
  // 고른 게 없으면 목록을 보여준다. 예전처럼 첫 식물로 넘어가지 않는다.
  const selectedPlant = model.find((plant) => plant.id === selectedPlantId) ?? null;
  const settingsPlant = model.find((plant) => plant.id === settingsPlantId) ?? null;
  const availableSensorDevices = useMemo(
    () => Array.from(new Set(readings.map((reading) => reading.device_id))).sort(),
    [readings],
  );
  const latestByLocation = useMemo(() => latestBy(readings, (reading) => reading.location), [readings]);
  const latestByDevice = useMemo(() => latestBy(readings, (reading) => reading.device_id), [readings]);
  const soilPlants = useMemo(() => model.filter((plant) => plant.soil_sensor_enabled && plant.soil_sensor_device_id), [model]);
  // 헤더에 늘 띄워두는 센서 표시. 실제로 값을 보내는 곳은 베란다뿐이다.
  const balconyReading = latestByLocation["베란다"];
  const balconyAge = sensorAgeHours(balconyReading, nowMs);
  const balconyStale = !isFresh(balconyReading, nowMs);
  const filtered = useMemo(() => {
    // 급한 것부터. 고를 일이 없어 정렬 칸은 두지 않는다.
    return [...model].sort((a, b) => (a.dday ?? 999) - (b.dday ?? 999));
  }, [model]);

  const wateredToday = logs.filter((log) => log.watered_at.slice(0, 10) === today).length;
  const dangerPlants = model.filter((plant) => plant.dday !== null && plant.dday < 0);
  const todayPlants = model.filter((plant) => plant.dday === 0);
  // 오늘 이미 물을 준 식물이 "곧 물줘야 함"에도 같이 잡혀 할 일이 남은 것처럼 보이던 문제를 막는다.
  const soonPlants = model.filter(
    (plant) =>
      plant.dday !== null &&
      plant.dday > 0 &&
      plant.dday <= 2 &&
      !plant.logs.some((log) => log.watered_at.slice(0, 10) === today),
  );
  const overdue = dangerPlants.length;
  const dueToday = todayPlants.length;
  const soon = soonPlants.length;

  const logsByDate = useMemo(() => {
    return logs.reduce<Record<string, WateringLog[]>>((acc, log) => {
      const date = log.watered_at.slice(0, 10);
      acc[date] = [...(acc[date] ?? []), log];
      return acc;
    }, {});
  }, [logs]);

  const memosByDate = useMemo(() => {
    return memos.reduce<Record<string, DayMemo[]>>((acc, memo) => {
      acc[memo.entry_date] = [...(acc[memo.entry_date] ?? []), memo];
      return acc;
    }, {});
  }, [memos]);

  const monthDays = useMemo(() => getMonthDays(calendarMonth), [calendarMonth]);
  const selectedDateLogs = logsByDate[selectedDate] ?? [];
  const selectedDateMemos = memosByDate[selectedDate] ?? [];

  async function addPlant(event: FormEvent) {
    event.preventDefault();
    await run("add-plant", async () => {
      const data = await fetchJson<{ plant: Plant }>("/api/plants", {
        method: "POST",
        body: JSON.stringify({ name: newPlant.name, location: newPlant.location }),
      });
      setPlants((prev) => [...prev, data.plant]);
      setNewPlant(blankPlant);
      setActiveTab("dashboard");
    });
  }

  async function deletePlant(plant: Plant) {
    const ok = window.confirm(`'${plant.name}' 식물을 삭제할까요?\n관련 설정도 함께 삭제됩니다.`);
    if (!ok) return;

    await run(`plant:${plant.id}`, async () => {
      await fetchJson<{ deleted: Plant }>(`/api/plants/${plant.id}`, { method: "DELETE" });
      setPlants((prev) => prev.filter((item) => item.id !== plant.id));
      if (settingsPlantId === plant.id) setSettingsPlantId(null);
      // 사진은 DB에서 함께 지워지므로 화면에서도 같이 치운다.
      // 남겨두면 열 때마다 404가 나는 유령 카드가 된다.
      setPhotos((prev) => prev.filter((item) => item.plant_id !== plant.id));
      setLightbox((prev) => (prev?.photo.plant_id === plant.id ? null : prev));
    });
  }

  async function saveDayRecord(event: FormEvent) {
    event.preventDefault();
    const hasPlants = bulkLog.plant_names.length > 0;
    const memo = bulkLog.memo.trim();

    if (!hasPlants && !memo) {
      window.alert("식물을 선택하거나, 메모를 입력해주세요.");
      return;
    }

    await run("day-record", async () => {
      if (hasPlants) {
        const data = await fetchJson<{ logs: WateringLog[] }>("/api/watering-logs", {
          method: "POST",
          body: JSON.stringify({
            plant_names: bulkLog.plant_names,
            watered_at: selectedDate,
            memo,
          }),
        });
        setLogs((prev) => [...data.logs, ...prev]);
      } else {
        const data = await fetchJson<{ memo: DayMemo }>("/api/day-memos", {
          method: "POST",
          body: JSON.stringify({ entry_date: selectedDate, content: memo }),
        });
        setMemos((prev) => [data.memo, ...prev]);
      }

      setBulkLog({ plant_names: [], memo: "" });
    });
  }

  function toggleBulkPlant(plantName: string) {
    setBulkLog((prev) => ({
      ...prev,
      plant_names: prev.plant_names.includes(plantName)
        ? prev.plant_names.filter((name) => name !== plantName)
        : [...prev.plant_names, plantName],
    }));
  }

  /** 헤더의 달력 버튼. 숨겨둔 날짜 입력의 브라우저 달력을 연다. */
  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;
    // showPicker는 크롬·사파리 16+에서 되고, 안 되는 곳은 포커스+클릭으로 연다.
    if ("showPicker" in input) {
      try {
        (input as HTMLInputElement & { showPicker: () => void }).showPicker();
        return;
      } catch {
        // 사용자 동작 밖이거나 미지원이면 아래로
      }
    }
    input.focus();
    input.click();
  }

  /** 대시보드에서 식물을 고르면 그 식물의 분석·기록 화면으로 넘어간다. */
  function openPlantAnalysis(plantId: string) {
    setSelectedPlantId(plantId);
    setActiveTab("analysis");
  }

  async function quickWater(plant: PlantModel) {
    await run(`water:${plant.id}`, async () => {
      const data = await fetchJson<{ log: WateringLog }>("/api/watering-logs", {
        method: "POST",
        body: JSON.stringify({
          plant_name: plant.name,
          watered_at: waterDate,
          memo: waterDate === today ? "대시보드 물주기" : `대시보드 물주기 (${waterDate} 기록)`,
        }),
      });
      setLogs((prev) => [data.log, ...prev]);
    });
  }

  async function deleteWateringLog(log: WateringLog) {
    const ok = window.confirm(`${log.watered_at.slice(0, 10)} ${log.plant_name} 급수 기록을 취소할까요?`);
    if (!ok) return;

    await run(`log:${log.id}`, async () => {
      await fetchJson<{ deleted: WateringLog }>(`/api/watering-logs/${log.id}`, { method: "DELETE" });
      setLogs((prev) => prev.filter((item) => item.id !== log.id));
    });
  }

  async function cancelWateringOn(plant: PlantModel, date: string) {
    // watered_at은 날짜뿐이라 정렬만으로는 같은 날 안에서 순서가 정해지지 않는다.
    // 그대로 두면 자동급수가 있고 사용자가 수동으로 한 번 더 준 경우,
    // "취소"가 방금 누른 수동 기록이 아니라 이른 시각의 자동급수 기록을 지웠다.
    const sameDayLogs = plant.logs.filter((log) => log.watered_at.slice(0, 10) === date);
    const target = sameDayLogs.reduce<WateringLog | null>(
      (latest, log) =>
        !latest || String(log.created_at ?? "") > String(latest.created_at ?? "") ? log : latest,
      null,
    );

    if (!target) {
      window.alert(`${date}에 취소할 급수 기록이 없습니다.`);
      return;
    }
    await deleteWateringLog(target);
  }

  async function loadEntries(plantId: string) {
    const data = await fetchJson<{ photos: PlantPhoto[] }>(
      `/api/plant-photos?plant_id=${encodeURIComponent(plantId)}`,
    );
    // 늦게 온 응답이 다른 식물의 목록을 덮어쓰지 않게 한다.
    setEntriesPlantId((current) => {
      if (current === plantId) setEntries(data.photos);
      return current;
    });
  }

  async function onEntryFileChange(file: File | null) {
    setPendingEntryPhoto(null);
    if (!file) return;

    await run("entry-prepare", async () => {
      try {
        const prepared = await preparePhoto(file);
        setPendingEntryPhoto({ ...prepared, name: file.name });
      } finally {
        if (entryInputRef.current) entryInputRef.current.value = "";
      }
    });
  }

  async function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!selectedPlant) return;

    const note = entryDraft.note.trim();
    if (!note && !pendingEntryPhoto) {
      window.alert("메모를 쓰거나 사진을 넣어주세요.");
      return;
    }

    const capturedAt = entryDraft.capturedAt || today;
    if (capturedAt > today) {
      window.alert("기록 날짜는 오늘 이후로 지정할 수 없습니다.");
      return;
    }

    const plantId = selectedPlant.id;
    await run("entry-save", async () => {
      const data = await fetchJson<{ photo: PlantPhoto }>("/api/plant-photos", {
        method: "POST",
        body: JSON.stringify({
          plant_id: plantId,
          image_url: pendingEntryPhoto?.image ?? null,
          thumb_url: pendingEntryPhoto?.thumb ?? null,
          note,
          captured_at: capturedAt,
        }),
      });

      const sortEntries = (list: PlantPhoto[]) =>
        [...list].sort(
          (a, b) =>
            b.captured_at.localeCompare(a.captured_at) ||
            String(b.created_at).localeCompare(String(a.created_at)),
        );

      // 저장하는 사이에 다른 식물로 넘어갔으면 그 식물 목록에 끼워 넣으면 안 된다.
      // 넘어간 순간 entriesPlantId가 바뀌므로, 누른 때가 아니라 지금 값을 봐야 한다.
      const insert = (prev: PlantPhoto[]) =>
        prev.some((item) => item.id === data.photo.id) ? prev : sortEntries([data.photo, ...prev]);
      setEntriesPlantId((current) => {
        if (current === plantId) {
          setEntries(insert);
          // 폼 비우기도 주인이 그대로일 때만. 그 사이 다른 식물로 넘어갔다면
          // 거기에 쓰던 메모가 지워지고 날짜까지 앞 식물 것으로 덮인다.
          setEntryDraft({ note: "", capturedAt });
          setPendingEntryPhoto(null);
          if (entryInputRef.current) entryInputRef.current.value = "";
        }
        return current;
      });
      // 기록 탭의 모아보기에도 반영한다.
      setPhotos(insert);
    });
  }

  async function deleteEntry(entry: PlantPhoto) {
    const ok = window.confirm(`${entry.captured_at} 기록을 삭제할까요?`);
    if (!ok) return;

    await run(`entry:${entry.id}`, async () => {
      await fetchJson<{ deleted: { id: string } }>(`/api/plant-photos/${entry.id}`, { method: "DELETE" });
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      setPhotos((prev) => prev.filter((item) => item.id !== entry.id));
      setLightbox((prev) => (prev?.photo.id === entry.id ? null : prev));
    });
  }

  /**
   * 분석 화면의 도판 자리에 사진을 바로 올린다. 고르는 즉시 오늘 날짜로 저장한다.
   * 메모까지 붙이려면 아래 기록 폼을 쓰면 된다.
   */
  async function onPlateFileChange(file: File | null) {
    if (!file || !selectedPlant) return;
    const plantId = selectedPlant.id;

    await run("plate-upload", async () => {
      try {
        const prepared = await preparePhoto(file);
        const data = await fetchJson<{ photo: PlantPhoto }>("/api/plant-photos", {
          method: "POST",
          body: JSON.stringify({
            plant_id: plantId,
            image_url: prepared.image,
            thumb_url: prepared.thumb,
            note: "",
            captured_at: today,
          }),
        });

        // 같은 항목이 두 번 들어가지 않게 id로 먼저 거른다.
        const insert = (prev: PlantPhoto[]) =>
          prev.some((item) => item.id === data.photo.id) ? prev : sortEntries([data.photo, ...prev]);

        // 올리는 사이에 다른 식물로 넘어갔으면 그 식물 목록에 끼워 넣으면 안 된다.
        // 넘어간 시점에 entriesPlantId가 곧바로 바뀌므로, 클릭 때 값이 아니라
        // 응답이 온 지금 값을 봐야 한다.
        setEntriesPlantId((current) => {
          if (current === plantId) setEntries(insert);
          return current;
        });
        setPhotos(insert);
      } finally {
        if (plateInputRef.current) plateInputRef.current.value = "";
      }
    });
  }

  async function onPhotoFileChange(file: File | null) {
    // 먼저 비운다. 새로 고른 사진의 변환이 실패했을 때 이전 사진이 남아 있으면,
    // 사용자는 새 사진을 올렸다고 생각하는데 엉뚱한 사진이 저장된다.
    setPendingPhoto(null);
    if (!file) return;

    await run("photo-prepare", async () => {
      try {
        const prepared = await preparePhoto(file);
        setPendingPhoto({ ...prepared, name: file.name });
      } finally {
        // 실패했을 때 input에 같은 파일이 남아 있으면 다시 골라도 change가 안 뜬다.
        if (photoInputRef.current) photoInputRef.current.value = "";
      }
    });
  }

  async function submitPhoto(event: FormEvent) {
    event.preventDefault();

    const note = photoDraft.note.trim();
    if (!pendingPhoto && !note) {
      window.alert("메모를 쓰거나 사진을 넣어주세요.");
      return;
    }

    const capturedAt = photoDraft.capturedAt || today;
    if (capturedAt > today) {
      window.alert("촬영일은 오늘 이후로 지정할 수 없습니다.");
      return;
    }

    await run("photo-upload", async () => {
      const data = await fetchJson<{ photo: PlantPhoto }>("/api/plant-photos", {
        method: "POST",
        body: JSON.stringify({
          plant_id: photoDraft.plantId || null,
          image_url: pendingPhoto?.image ?? null,
          thumb_url: pendingPhoto?.thumb ?? null,
          note,
          captured_at: capturedAt,
        }),
      });

      // 서버 목록과 같은 기준으로 정렬한다. 무조건 앞에 붙이면 과거 날짜 사진이
      // 가장 최신인 것처럼 보인다.
      setPhotos((prev) =>
        [data.photo, ...prev].sort(
          (a, b) =>
            b.captured_at.localeCompare(a.captured_at) ||
            String(b.created_at).localeCompare(String(a.created_at)),
        ),
      );
      // 지금 분석 화면에서 보고 있는 식물의 기록이면 거기에도 바로 반영한다.
      // 저장하는 사이에 분석 화면의 식물이 바뀔 수 있으므로, 폼을 그릴 때 값이 아니라
      // 응답이 온 지금 값과 맞춰본다.
      setEntriesPlantId((current) => {
        if (data.photo.plant_id && data.photo.plant_id === current) {
          setEntries((prev) =>
            prev.some((item) => item.id === data.photo.id) ? prev : sortEntries([data.photo, ...prev]),
          );
        }
        return current;
      });

      setPendingPhoto(null);
      setPhotoDraft((prev) => ({ ...prev, note: "" }));
      setPhotosError("");
      setPhotosLoaded(true);
      if (photoInputRef.current) photoInputRef.current.value = "";
    });
  }

  async function deletePhoto(photo: PlantPhoto) {
    const ok = window.confirm(`${photo.plant_name}의 ${photo.captured_at} 사진을 삭제할까요?`);
    if (!ok) return;

    await run(`photo:${photo.id}`, async () => {
      await fetchJson<{ deleted: { id: string } }>(`/api/plant-photos/${photo.id}`, { method: "DELETE" });
      setPhotos((prev) => prev.filter((item) => item.id !== photo.id));
      // 분석 탭의 그 식물 기록에서도 빼야 한다. 안 빼면 지운 사진이 목록에 남고,
      // 도판에까지 걸려 열면 404가 난다.
      setEntries((prev) => prev.filter((item) => item.id !== photo.id));
      setLightbox((prev) => (prev?.photo.id === photo.id ? null : prev));
    });
  }

  async function openPhoto(photo: PlantPhoto) {
    setLightbox({ photo, imageUrl: null, status: "loading" });
    await run(`photo-open:${photo.id}`, async () => {
      try {
        const data = await fetchJson<{ image_url: string }>(`/api/plant-photos/${photo.id}`);
        // 여는 도중 다른 사진으로 넘어갔으면 늦게 온 응답으로 덮어쓰지 않는다.
        setLightbox((prev) =>
          prev?.photo.id === photo.id ? { ...prev, imageUrl: data.image_url, status: "ready" } : prev,
        );
      } catch (error) {
        // 실패를 알리지 않으면 "불러오는 중"에서 영원히 멈춘 것처럼 보인다.
        setLightbox((prev) => (prev?.photo.id === photo.id ? { ...prev, status: "error" } : prev));
        // 이미 지워진 사진이면 목록에서도 치운다.
        if (error instanceof Error && /찾을 수 없습니다/.test(error.message)) {
          setPhotos((prev) => prev.filter((item) => item.id !== photo.id));
          setEntries((prev) => prev.filter((item) => item.id !== photo.id));
        }
        throw error;
      }
    });
  }

  async function deleteDayMemo(memo: DayMemo) {
    const ok = window.confirm("이 메모를 삭제할까요?");
    if (!ok) return;

    await run(`memo:${memo.id}`, async () => {
      await fetchJson<{ deleted: DayMemo }>(`/api/day-memos/${memo.id}`, { method: "DELETE" });
      setMemos((prev) => prev.filter((item) => item.id !== memo.id));
    });
  }

  /** 급수 탭에서는 표의 한 줄이, 예전 설정 모달에서는 패널이 입력 묶음이다. */
  function readAutomationInputs(plant: Plant, target: HTMLElement) {
    const panel = target.closest(".automation-grid, tr");
    const readNumber = (name: string, fallback: number, min: number, max: number) => {
      const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      // 빈 칸이면 Number("")가 0이 되어 DB 제약을 위반하던 문제가 있어 명시적으로 걸러낸다.
      const raw = input?.value.trim();
      const parsed = raw ? Number(raw) : NaN;
      const value = Number.isFinite(parsed) ? parsed : fallback;
      // 급수 초·쿨다운·하루 최대는 DB가 정수 칼럼이다. 소수를 그대로 보내면 저장이 깨진다.
      const whole = name === "moisture_min_pct" ? value : Math.round(value);
      return Math.min(max, Math.max(min, whole));
    };

    return {
      panel,
      values: {
        moisture_min_pct: readNumber("moisture_min_pct", plant.moisture_min_pct ?? 30, ...MOISTURE_RANGE),
        watering_seconds: readNumber("watering_seconds", plant.watering_seconds ?? 5, ...SECONDS_RANGE),
        cooldown_hours: readNumber("cooldown_hours", plant.cooldown_hours ?? 12, ...COOLDOWN_RANGE),
        max_runs_per_day: readNumber("max_runs_per_day", plant.max_runs_per_day ?? 2, ...MAX_RUNS_RANGE),
      },
    };
  }

  /**
   * 저장한 값을 입력칸에 되쓴다. 칸을 비우고 저장하면 이전 값이 그대로 남는데,
   * 화면은 빈 칸이라 사용자는 지워진 줄 알았다.
   */
  function writeBackAutomationInputs(panel: Element | null, values: Record<string, number>) {
    Object.entries(values).forEach(([name, value]) => {
      const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input) input.value = String(value);
    });
  }

  /**
   * 켜기·끄기도 그 줄에 적어둔 값을 함께 보낸다.
   * 값만 바꾸고 켜기를 누르면 줄이 다시 그려지며 타이핑한 값이 조용히 사라졌다.
   */
  async function toggleAutomation(plant: Plant, target: HTMLElement) {
    const { panel, values } = readAutomationInputs(plant, target);
    await run(`auto:${plant.id}`, async () => {
      await updateAutomation(plant, { enabled: !plant.automation_enabled, ...values });
      writeBackAutomationInputs(panel, values);
    });
  }

  async function updateAutomation(
    plant: Plant,
    overrides: Partial<{
      enabled: boolean;
      pump_device_id: string;
      moisture_min_pct: number;
      watering_seconds: number;
      cooldown_hours: number;
      max_runs_per_day: number;
    }>,
  ) {
    const enabled = overrides.enabled ?? plant.automation_enabled ?? true;
    const balcony = "베란다";
    const config = await fetchJson<{ config: Partial<Plant> }>(`/api/plants/${plant.id}/automation`, {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        pump_device_id:
          overrides.pump_device_id ?? plant.pump_device_id ?? (plant.location === balcony ? "pump-balcony-01" : "pump-living-01"),
        moisture_min_pct: overrides.moisture_min_pct ?? plant.moisture_min_pct ?? 30,
        watering_seconds: overrides.watering_seconds ?? plant.watering_seconds ?? 5,
        cooldown_hours: overrides.cooldown_hours ?? plant.cooldown_hours ?? 12,
        max_runs_per_day: overrides.max_runs_per_day ?? plant.max_runs_per_day ?? 2,
      }),
    });

    setPlants((prev) =>
      prev.map((item) =>
        item.id === plant.id ? { ...item, ...config.config, automation_enabled: enabled } : item,
      ),
    );
  }

  async function saveAutomationFromPanel(plant: Plant, target: HTMLElement, notify = true) {
    const { panel, values } = readAutomationInputs(plant, target);

    await run(`auto:${plant.id}`, async () => {
      await updateAutomation(plant, values);
      writeBackAutomationInputs(panel, values);
      if (notify) window.alert("자동급수 설정을 저장했습니다.");
    });
  }

  /** 급수 탭의 일괄 설정. 같은 기준을 모든 식물에 한 번에 넣는다. */
  async function applyBulkAutomation(event: FormEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const readNumber = (name: string, fallback: number, min: number, max: number) => {
      const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      const raw = input?.value.trim();
      const parsed = raw ? Number(raw) : NaN;
      const value = Number.isFinite(parsed) ? parsed : fallback;
      const whole = name === "moisture_min_pct" ? value : Math.round(value);
      return Math.min(max, Math.max(min, whole));
    };

    const values = {
      moisture_min_pct: readNumber("moisture_min_pct", 30, ...MOISTURE_RANGE),
      watering_seconds: readNumber("watering_seconds", 5, ...SECONDS_RANGE),
      cooldown_hours: readNumber("cooldown_hours", 12, ...COOLDOWN_RANGE),
      max_runs_per_day: readNumber("max_runs_per_day", 2, ...MAX_RUNS_RANGE),
    };

    const targets = model;
    if (!targets.length) return;
    const ok = window.confirm(
      `${targets.length}종 전부에 같은 급수 설정을 넣습니다.\n` +
        `수분 ${values.moisture_min_pct}% 미만 · ${values.watering_seconds}초 · ` +
        `쿨다운 ${values.cooldown_hours}시간 · 하루 ${values.max_runs_per_day}회`,
    );
    if (!ok) return;

    await run("bulk-auto", async () => {
      // 하나라도 실패하면 어디까지 됐는지 알려야 한다. 순서대로 보내고 실패를 모은다.
      const failed: string[] = [];
      for (const plant of targets) {
        try {
          await updateAutomation(plant, values);
          // 한 줄 반영될 때마다 표시해야, 루프 도중 도착한 전체 새로고침이
          // 앞서 저장한 식물들을 예전 값으로 되돌리지 않는다.
          mutationCount.current += 1;
        } catch {
          failed.push(plant.name);
        }
      }
      window.alert(
        failed.length
          ? `${targets.length - failed.length}종 적용, ${failed.length}종 실패: ${failed.join(", ")}`
          : `${targets.length}종에 적용했습니다.`,
      );
    });
  }

  async function queuePumpTest(plant: Plant) {
    await run(`pump:${plant.id}`, async () => {
      await fetchJson<{ command: unknown }>("/api/pump-commands", {
        method: "POST",
        body: JSON.stringify({
          plant_id: plant.id,
          plant_name: plant.name,
          location: plant.location,
          pump_device_id: plant.pump_device_id ?? "pump-balcony-01",
          watering_seconds: 5,
        }),
      });
      window.alert("펌프 테스트 명령을 만들었습니다. ESP32가 30초 안에 가져가서 5초 작동합니다.");
    });
  }

  async function connectSoilSensor(plant: Plant, sensorDeviceId: string) {
    await run(`sensor:${plant.id}`, async () => {
      const enabled = Boolean(sensorDeviceId);
      const data = await fetchJson<{ config: Partial<Plant> }>(`/api/plants/${plant.id}/sensor`, {
        method: "PUT",
        body: JSON.stringify({ soil_sensor_enabled: enabled, soil_sensor_device_id: sensorDeviceId }),
      });

      setPlants((prev) =>
        prev.map((item) =>
          item.id === plant.id
            ? {
                ...item,
                soil_sensor_enabled: Boolean(data.config.soil_sensor_enabled),
                soil_sensor_device_id: (data.config.soil_sensor_device_id as string | null) ?? null,
              }
            : sensorDeviceId && item.soil_sensor_device_id === sensorDeviceId
              ? { ...item, soil_sensor_enabled: false }
              : item,
        ),
      );
    });
  }

  const yesterday = addDays(today, -1);
  // 분석 탭에서 보고 있는 식물의 기록을 불러온다.
  useEffect(() => {
    if (activeTab !== "analysis" || !selectedPlant) return;
    if (entriesPlantId === selectedPlant.id) return;

    const plantId = selectedPlant.id;
    setEntriesPlantId(plantId);
    setEntries([]);
    setEntryDraft({ note: "", capturedAt: today });
    setPendingEntryPhoto(null);
    run(`entries:${plantId}`, () => loadEntries(plantId));
  }, [activeTab, selectedPlant?.id, entriesPlantId, today]);

  const allGaps = selectedPlant ? wateringGaps(selectedPlant.logs) : [];
  // 최근 것만 그린다. 다 그리면 옆으로 넘치고 막대가 실처럼 가늘어진다.
  const MAX_BARS = 20;
  const analysisGaps = allGaps.slice(-MAX_BARS);
  const hiddenGaps = allGaps.length - analysisGaps.length;
  /**
   * 도판 자리에 거는 사진. 이 식물 기록 중 가장 최근 사진을 쓰고, 없으면 삽화를 그린다.
   * 목록이 아직 다른 식물 것이면 남의 사진이 걸리므로 소유를 확인한다.
   */
  /**
   * 화면에 걸어도 되는 기록. 식물을 바꾼 직후 한 프레임 동안 앞 식물의 기록이
   * 새 식물 이름 아래 그려지던 것을 막는다. 효과는 그리고 난 뒤에 돈다.
   */
  const ownedEntries = selectedPlant && entriesPlantId === selectedPlant.id ? entries : [];
  const plateEntry =
    selectedPlant && entriesPlantId === selectedPlant.id
      ? ownedEntries.find(
          // 목록 주인만 확인하면 부족하다. 어쩌다 남의 기록이 섞여 들어오면
          // 그게 이 식물의 대표 사진으로 걸려, 삭제할 때 남의 기록을 지우게 된다.
          (entry) => entry.plant_id === selectedPlant.id && entry.has_image && entry.thumb_url,
        ) ?? null
      : null;
  const maxGap = Math.max(1, ...analysisGaps.map((item) => item.gap));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div>
            <div className="eyebrow">
              <Sprout size={16} />
              Hortus Domesticus
            </div>
            <h1>J&rsquo;s Smart Farm</h1>
          </div>
          <div className="actions instruments">
            {/* 물 준 날짜. ‹ ›로 하루씩, 달력으로 멀리. 브라우저에 붙은 뒤에만 그려
                서버 시계(UTC)로 그린 날짜가 잠깐 보이지 않게 한다. */}
            {mounted && (
              <div className={`date-chip ${waterDate === today ? "" : "past"}`} title="물주기를 누를 때 기록될 날짜">
                <button
                  type="button"
                  className="date-step"
                  onClick={() => setWaterDate(addDays(waterDate, -1))}
                  aria-label="하루 전"
                >
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="date-label" onClick={openDatePicker} aria-label="달력에서 날짜 고르기">
                  <span className="date-label-rel">
                    {waterDate === today
                      ? "오늘"
                      : waterDate === yesterday
                        ? "어제"
                        : `${dateDiff(today, waterDate)}일 전`}
                  </span>
                  <span className="date-label-abs">{koreanDate(waterDate)}</span>
                </button>
                <button
                  type="button"
                  className="date-step"
                  disabled={waterDate >= today}
                  onClick={() => setWaterDate(addDays(waterDate, 1))}
                  aria-label="하루 뒤"
                >
                  <ChevronRight size={16} />
                </button>
                <button type="button" className="date-step date-cal" onClick={openDatePicker} aria-label="달력">
                  <CalendarDays size={15} />
                </button>
                <input
                  ref={dateInputRef}
                  className="date-hidden"
                  type="date"
                  max={today}
                  value={waterDate}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => setWaterDate(event.target.value || today)}
                />
              </div>
            )}

            {/* 센서: 연결됐으면 초록 테두리, 끊겼으면 붉은 테두리. 값만 보인다. */}
            <div
              className={`sensor-chip ${balconyReading && !balconyStale ? "live" : "stale"}`}
              title={
                balconyReading
                  ? balconyStale
                    ? `센서 마지막 수신 ${balconyAge === null ? "시각 불명" : formatAge(balconyAge)}. ${SENSOR_STALE_HOURS}시간을 넘어 급수 주기 계산에서 제외했습니다. ESP32 전원과 Wi-Fi를 확인하세요.`
                    : `센서 연결됨 · ${localStamp(balconyReading.recorded_at)}`
                  : "센서가 아직 값을 보내지 않았습니다."
              }
            >
              <Home size={13} className="sensor-chip-mark" />
              <span className="sensor-chip-vals">
                {balconyReading ? (
                  <>
                    <b>{balconyReading.temperature_c}&deg;C</b>
                    <b>{balconyReading.humidity_pct}%</b>
                    <b>{balconyReading.light_lux}lx</b>
                  </>
                ) : (
                  <b className="sensor-chip-idle">대기 중</b>
                )}
              </span>
            </div>

            {/* 집계. 낱말이 어색해 라틴 약어로 둔다. 자세한 이름은 툴팁. */}
            <div className="tally">
              <span className="tally-item late" title={`늦음: ${listPlantNames(dangerPlants)}`}>
                <em>Late</em>
                <b>{overdue}</b>
              </span>
              <span className="tally-item today" title={`오늘: ${listPlantNames(todayPlants)}`}>
                <em>Today</em>
                <b>{dueToday}</b>
              </span>
              <span className="tally-item soon" title={`이틀 안: ${listPlantNames(soonPlants)}`}>
                <em>Soon</em>
                <b>{soon}</b>
              </span>
              <span className="tally-item done" title={`오늘 준 기록 ${wateredToday}건 · 모두 ${model.length}종`}>
                <em>Done</em>
                <b>{wateredToday}</b>
              </span>
            </div>

            <button className="icon-btn refresh-btn" onClick={loadAll} disabled={loading} title="새로고침" aria-label="새로고침">
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      </header>

      <div className="wrap layout">
        <aside className="sidenav">
          <button className={`navitem ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            <Leaf size={17} /> 관리판
          </button>
          <button className={`navitem ${activeTab === "status" ? "active" : ""}`} onClick={() => setActiveTab("status")}>
            <BarChart3 size={17} /> 전체 현황
          </button>
          <button className={`navitem ${activeTab === "analysis" ? "active" : ""}`} onClick={() => setActiveTab("analysis")}>
            <Activity size={17} /> 식물 분석
          </button>
          <button className={`navitem ${activeTab === "calendar" ? "active" : ""}`} onClick={() => setActiveTab("calendar")}>
            <CalendarDays size={17} /> 급수 캘린더
          </button>
          <button className={`navitem ${activeTab === "photos" ? "active" : ""}`} onClick={() => setActiveTab("photos")}>
            <StickyNote size={17} /> 기록
          </button>
          <button className={`navitem ${activeTab === "water" ? "active" : ""}`} onClick={() => setActiveTab("water")}>
            <Droplets size={17} /> 급수
          </button>
          <button className={`navitem ${activeTab === "add" ? "active" : ""}`} onClick={() => setActiveTab("add")}>
            <Plus size={17} /> 새 식물
          </button>

          <div className="sidenav-plate" aria-hidden="true">
            <svg viewBox="0 0 96 130" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M48 128 C48 100 48 70 50 22" />
              <path d="M49 96 C38 94 28 88 26 76 C38 78 47 86 49 96Z" />
              <path d="M31 84 L40 89 M30 80 L38 85" />
              <path d="M50 78 C61 76 71 70 73 58 C61 60 52 68 50 78Z" />
              <path d="M68 66 L59 71 M69 62 L61 67" />
              <path d="M49 60 C38 58 29 51 28 40 C40 42 48 50 49 60Z" />
              <path d="M33 48 L41 53 M32 44 L40 49" />
              <path d="M50 44 C60 42 68 36 69 26 C59 28 52 35 50 44Z" />
              <path d="M64 33 L57 38 M65 30 L58 35" />
              <path d="M50 22 C47 17 47 12 50 6 C53 12 53 17 50 22Z" />
              <path d="M42 126 C46 122 52 122 56 126" />
            </svg>
            <span className="latin">Ocimum basilicum</span>
          </div>
        </aside>

        <div className="content-col">
          {error && <div className="error">{error}</div>}

          {activeTab === "dashboard" && (
            <section className="dash">
              {loading ? (
                <div className="empty">DB에서 데이터를 불러오는 중입니다.</div>
              ) : filtered.length === 0 ? (
                <div className="empty">표시할 식물이 없습니다. ‘새 식물’ 메뉴에서 추가해보세요.</div>
              ) : (
                <div className="plant-grid">
                  {filtered.map((plant, index) => {
                    const status = statusFor(plant.dday);
                    const wateredOnDate = plant.logs.some((log) => log.watered_at.slice(0, 10) === waterDate);
                    const dateLabel = waterDate === today ? "" : ` ${waterDate.slice(5).replace("-", "/")}`;
                    return (
                      <article
                        className={`pcard tone-${status.className}`}
                        key={plant.id}
                        style={{ "--i": index } as React.CSSProperties}
                      >
                        <button
                          type="button"
                          className="pcard-open"
                          title={`${plant.name} 기록·분석 보기`}
                          onClick={() => openPlantAnalysis(plant.id)}
                        >
                          <span className="pcard-figure">
                            <PlantArt name={plant.name} category={plant.category} />
                          </span>
                          <span className="pcard-id">
                            <strong>{plant.name}</strong>
                            {latinNameFor(plant.name) && (
                              <em className="latin">{latinNameFor(plant.name)}</em>
                            )}
                          </span>
                          <span className={`status ${status.className}`} title={status.full}>
                            {status.label}
                          </span>
                        </button>

                        <div className="pcard-line">
                          <span>
                            <em>Last</em>
                            <strong title={plant.lastWatered ?? undefined}>
                              {plant.lastWatered ? shortDate(plant.lastWatered) : "—"}
                            </strong>
                          </span>
                          <span>
                            <em>Next</em>
                            <strong title={plant.nextDue ?? undefined}>
                              {plant.nextDue ? shortDate(plant.nextDue) : "—"}
                            </strong>
                          </span>
                        </div>

                        <div className="pcard-actions">
                          {wateredOnDate ? (
                            <button
                              className="btn water-btn done"
                              disabled={isBusy(`water:${plant.id}`)}
                              onClick={() => cancelWateringOn(plant, waterDate)}
                            >
                              <CheckCircle size={15} />{dateLabel} 물 줬음 · 취소
                            </button>
                          ) : (
                            <button
                              className="btn primary water-btn"
                              disabled={isBusy(`water:${plant.id}`)}
                              onClick={() => quickWater(plant)}
                            >
                              <Droplets size={15} />{dateLabel} 물주기
                            </button>
                          )}
                          <button className="icon-btn danger sm" title="식물 삭제" onClick={() => deletePlant(plant)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === "status" && (
            <section className="tab-page">
              <div className="panel table-panel">
                <div className="panel-title">
                  <h2><BarChart3 size={18} /> 전체 식물 현황</h2>
                  <span className="meta">분석 주기 포함</span>
                </div>
                <div className="table-scroll">
                  <table className="plant-table">
                    <thead>
                      <tr>
                        <th>D-day</th>
                        <th>식물</th>
                        <th>분류</th>
                        <th>마지막</th>
                        <th>다음</th>
                        <th>주기</th>
                        <th>기록</th>
                        <th>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.map((plant) => {
                        const status = statusFor(plant.dday);
                        return (
                          <tr key={plant.id}>
                            <td>
                              <span className={`status ${status.className}`} title={status.full}>
                                {status.label}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="plant-open"
                                title={`${plant.name} 분석 보기`}
                                onClick={() => openPlantAnalysis(plant.id)}
                              >
                                {plant.name}
                                <ChevronRight size={13} />
                              </button>
                            </td>
                            <td>{plant.category || "—"}</td>
                            <td title={plant.lastWatered ?? undefined}>
                              {plant.lastWatered ? shortDate(plant.lastWatered) : "—"}
                            </td>
                            <td title={plant.nextDue ?? undefined}>
                              {plant.nextDue ? shortDate(plant.nextDue) : "—"}
                            </td>
                            <td>{plant.interval}일</td>
                            <td>{plant.logs.length}</td>
                            <td className="cell-note">{plant.care_note || plant.memo || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeTab === "analysis" && !selectedPlant && (
            <section className="tab-page">
              <div className="panel">
                <div className="panel-title">
                  <h2><Activity size={18} /> 식물 분석</h2>
                  <span className="meta">{model.length}종 &middot; 눌러서 자세히</span>
                </div>

                <div className="plant-picker">
                  {model.map((plant) => {
                    const status = statusFor(plant.dday);
                    return (
                      <button
                        key={plant.id}
                        type="button"
                        className="pick-item"
                        onClick={() => setSelectedPlantId(plant.id)}
                      >
                        <span className="pick-art">
                          <PlantArt name={plant.name} category={plant.category} />
                        </span>
                        <span className="pick-id">
                          <strong>{plant.name}</strong>
                          {latinNameFor(plant.name) && (
                            <em className="latin">{latinNameFor(plant.name)}</em>
                          )}
                        </span>
                        <span className={`status ${status.className}`} title={status.full}>
                          {status.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {activeTab === "analysis" && selectedPlant && (
            <section className="tab-page">
              <div className="panel">
                  <div className="panel-title analysis-head">
                    <button type="button" className="btn sm back-btn" onClick={() => setSelectedPlantId("")}>
                      <ChevronLeft size={15} /> 목록
                    </button>
                    <h2>
                      {selectedPlant.name}
                      {latinNameFor(selectedPlant.name) && (
                        <span className="latin h2-latin">{latinNameFor(selectedPlant.name)}</span>
                      )}
                    </h2>
                  </div>

                  <div className="plate">
                    <div className="plate-left">
                    <figure className="plate-figure">
                      {plateEntry ? (
                        <button
                          type="button"
                          className="plate-photo"
                          title="크게 보기"
                          onClick={() => openPhoto(plateEntry)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={plateEntry.thumb_url as string}
                            alt={`${selectedPlant.name} ${plateEntry.captured_at}`}
                          />
                        </button>
                      ) : (
                        <div className="plate-art">
                          <PlantArt name={selectedPlant.name} category={selectedPlant.category} />
                        </div>
                      )}

                      <figcaption>
                        {latinNameFor(selectedPlant.name) && (
                          <span className="latin plate-latin">{latinNameFor(selectedPlant.name)}</span>
                        )}
                        <span className="plate-foot">
                          {plateEntry ? `${plateEntry.captured_at} 촬영` : "삽화"}
                          {selectedPlant.category ? ` · ${selectedPlant.category}` : ""}
                        </span>
                      </figcaption>

                      <label className="plate-upload">
                        <input
                          ref={plateInputRef}
                          type="file"
                          accept="image/*"
                          disabled={isBusy("plate-upload")}
                          onChange={(event) => onPlateFileChange(event.target.files?.[0] ?? null)}
                        />
                        <span className="btn sm">
                          <Camera size={14} /> {isBusy("plate-upload") ? "올리는 중…" : "사진 올리기"}
                        </span>
                      </label>
                    </figure>

                    {/* 이 식물 자체의 정보. 측정값이 아니라 설정과 일반 재배 지침이다. */}
                    {(() => {
                      const note = noteFor(selectedPlant.name, selectedPlant.category);
                      const facts: Array<[string, string]> = [
                        ["분류", selectedPlant.category || "—"],
                        ["물", selectedPlant.water_level || "—"],
                        ["빛", selectedPlant.sunlight || "—"],
                      ];
                      if (selectedPlant.difficulty) facts.push(["난이도", selectedPlant.difficulty]);
                      return (
                        <div className="species">
                          <dl className="species-facts">
                            {facts.map(([k, v]) => (
                              <div key={k}>
                                <dt>{k}</dt>
                                <dd>{v}</dd>
                              </div>
                            ))}
                          </dl>
                          {note && (
                            <div className="species-note">
                              <p className="species-summary">{note.summary}</p>
                              <dl className="species-facts">
                                <div><dt>빛</dt><dd>{note.light}</dd></div>
                                <div><dt>물</dt><dd>{note.water}</dd></div>
                              </dl>
                              <p className="species-tip">{note.tip}</p>
                            </div>
                          )}
                          {(selectedPlant.care_note || selectedPlant.environment_recommendation) && (
                            <p className="species-tip">
                              {selectedPlant.care_note || selectedPlant.environment_recommendation}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                    </div>

                    <div className="plate-data">
                      <div className="analysis-cards">
                        <div className="metric"><span className="meta">총 급수</span><strong>{selectedPlant.logs.length}회</strong></div>
                        <div className="metric"><span className="meta">최근 평균</span><strong>{selectedPlant.learnedInterval ?? "-"}일</strong></div>
                        <div className="metric"><span className="meta">분석 주기</span><strong>{selectedPlant.interval}일</strong></div>
                        <div className="metric"><span className="meta">다음 예정</span><strong>{selectedPlant.nextDue ?? "-"}</strong></div>
                      </div>

                      <div className="chart-block">
                        <div className="chart-title">
                          급수 간격(일) 추이
                          {hiddenGaps > 0 && <span className="meta"> · 최근 {MAX_BARS}회, 앞 {hiddenGaps}회 생략</span>}
                        </div>
                        {analysisGaps.length ? (
                          <div className="bars">
                            {analysisGaps.map((item, index) => (
                              <div className="bar-col" key={`${index}-${item.date}`} title={`${item.date} · 직전 급수와 ${item.gap}일 간격`}>
                                <div className="bar-val">{item.gap}</div>
                                <div className="bar-track">
                                  <div className="bar" style={{ height: `${(item.gap / maxGap) * 100}%` }} />
                                </div>
                                <div className="bar-x">{item.date.slice(5)}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty compact-empty">급수 기록이 2회 이상이면 간격 그래프가 표시됩니다.</div>
                        )}
                      </div>

                      <div className="analysis-box">
                        <ul>
                          {selectedPlant.recommendationReasons.map((reason, index) => (
                            <li key={`${index}-${reason}`}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="journal">
                    <div className="chart-title journal-title">
                      <span><StickyNote size={15} /> 이 식물의 기록</span>
                      <span className="meta">{ownedEntries.length}건</span>
                    </div>

                    <form className="journal-form" onSubmit={submitEntry}>
                      <div className="journal-form-top">
                        <input
                          className="input"
                          type="date"
                          max={today}
                          value={entryDraft.capturedAt || today}
                          onChange={(event) =>
                            setEntryDraft({ ...entryDraft, capturedAt: event.target.value || today })
                          }
                        />
                        <input
                          ref={entryInputRef}
                          className="input file-input"
                          type="file"
                          accept="image/*"
                          disabled={isBusy("entry-prepare") || isBusy("entry-save")}
                          onChange={(event) => onEntryFileChange(event.target.files?.[0] ?? null)}
                        />
                      </div>

                      <textarea
                        className="input textarea"
                        placeholder="잎이 늘었다, 분갈이함, 벌레 보임 … (사진만 남겨도 됩니다)"
                        maxLength={500}
                        value={entryDraft.note}
                        onChange={(event) => setEntryDraft({ ...entryDraft, note: event.target.value })}
                      />

                      {isBusy("entry-prepare") && <div className="photo-preview-note">사진을 줄이는 중…</div>}

                      {pendingEntryPhoto && (
                        <div className="photo-preview">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pendingEntryPhoto.thumb} alt="선택한 사진 미리보기" />
                          <div className="photo-preview-body">
                            <strong>{pendingEntryPhoto.name}</strong>
                            <span className="meta">약 {Math.round(pendingEntryPhoto.image.length / 1400)}KB로 줄였습니다</span>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => {
                                setPendingEntryPhoto(null);
                                if (entryInputRef.current) entryInputRef.current.value = "";
                              }}
                            >
                              <X size={14} /> 사진 빼기
                            </button>
                          </div>
                        </div>
                      )}

                      <button
                        className="btn primary"
                        type="submit"
                        disabled={isBusy("entry-save") || isBusy("entry-prepare")}
                      >
                        <Plus size={16} /> {isBusy("entry-save") ? "저장 중…" : "기록 남기기"}
                      </button>
                    </form>

                    {isBusy(`entries:${selectedPlant.id}`) ? (
                      <div className="empty compact-empty">기록을 불러오는 중입니다.</div>
                    ) : ownedEntries.length ? (
                      <div className="photo-grid">
                        {ownedEntries.map((entry, index) => (
                          <figure className="photo-card" key={entry.id} style={{ "--i": index } as React.CSSProperties}>
                            {entry.thumb_url && entry.has_image ? (
                              <button
                                className="photo-thumb"
                                title="크게 보기"
                                onClick={() => openPhoto(entry)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={entry.thumb_url}
                                  alt={`${selectedPlant.name} ${entry.captured_at}`}
                                  loading="lazy"
                                  onError={(event) => {
                                    // 깨진 이미지는 alt 글자가 칸을 넘어 줄을 흐트러뜨린다.
                                    event.currentTarget.style.display = "none";
                                  }}
                                />
                              </button>
                            ) : (
                              <div className="photo-thumb note-only">
                                <StickyNote size={20} />
                              </div>
                            )}
                            <figcaption>
                              <div className="photo-caption-main">
                                <strong>{entry.captured_at}</strong>
                                <span className="meta">Fig.</span>
                              </div>
                              {entry.note && <p>{entry.note}</p>}
                            </figcaption>
                            <button
                              className="icon-btn danger sm photo-delete"
                              title="기록 삭제"
                              disabled={isBusy(`entry:${entry.id}`)}
                              onClick={() => deleteEntry(entry)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </figure>
                        ))}
                      </div>
                    ) : (
                      <div className="empty compact-empty">아직 이 식물의 기록이 없습니다. 위에서 첫 기록을 남겨보세요.</div>
                    )}
                  </div>

                  <div className="chart-title journal-title">
                    <span><Droplets size={15} /> 급수 기록</span>
                    <span className="meta">{selectedPlant.logs.length}회</span>
                  </div>

                  <div className="calendar-items log-list">
                    {selectedPlant.logs.slice().reverse().map((log) => (
                      <div className="calendar-item" key={log.id}>
                        <div>
                          <strong>{log.watered_at.slice(0, 10)}</strong>
                          <span>{log.memo || (log.source === "automation" ? "자동급수" : "수동 기록")}</span>
                        </div>
                        <button className="icon-btn danger" onClick={() => deleteWateringLog(log)} title="기록 취소">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
              </div>
            </section>
          )}

          {activeTab === "calendar" && (
            <section className="tab-page">
              <div className="calendar-layout">
                <div className="panel calendar-panel">
                  <div className="panel-title">
                    <h2><CalendarDays size={18} /> 급수 캘린더</h2>
                    <div className="month-controls">
                      <button className="icon-btn" onClick={() => setCalendarMonth((prev) => moveMonth(prev, -1))}>
                        <ChevronLeft size={16} />
                      </button>
                      <strong>{calendarMonth}</strong>
                      <button className="icon-btn" onClick={() => setCalendarMonth((prev) => moveMonth(prev, 1))}>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="month-grid">
                    {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                      <div className="weekday" key={day}>{day}</div>
                    ))}
                    {monthDays.map((day) => {
                      const dayLogs = logsByDate[day.date] ?? [];
                      const count = dayLogs.length;
                      const memoCount = memosByDate[day.date]?.length ?? 0;
                      // 같은 식물을 하루에 두 번 줬어도 이름은 한 번만 적는다.
                      const dayNames = Array.from(new Set(dayLogs.map((log) => log.plant_name)));
                      return (
                        <button
                          className={`day-cell ${day.inMonth ? "" : "muted"} ${selectedDate === day.date ? "selected" : ""} ${day.date === today ? "today" : ""}`}
                          key={day.date}
                          onClick={() => setSelectedDate(day.date)}
                          // 칸에는 세 종만 적히므로, 마우스를 올리면 그날 준 것을 전부 보여준다.
                          title={
                            dayNames.length
                              ? `${day.date}\n물 준 식물 ${dayNames.length}종\n${dayNames.join(", ")}${memoCount ? `\n메모 ${memoCount}건` : ""}`
                              : memoCount
                                ? `${day.date}\n메모 ${memoCount}건`
                                : day.date
                          }
                        >
                          <span className="day-num">{Number(day.date.slice(-2))}</span>
                          {memoCount > 0 && <span className="diary-mark" title={`메모 ${memoCount}건`}>&dagger;</span>}
                          {dayNames.length > 0 && (
                            <span className="day-plants">
                              {dayNames.slice(0, 3).map((name) => (
                                <span className="day-plant" key={name} title={name}>
                                  {name}
                                </span>
                              ))}
                              {dayNames.length > 3 && (
                                <span className="day-more">&plus;{dayNames.length - 3}</span>
                              )}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <aside className="panel day-detail">
                  <div className="panel-title">
                    <h2>{selectedDate}</h2>
                    <span className="meta">급수 {selectedDateLogs.length} · 메모 {selectedDateMemos.length}</span>
                  </div>

                  <div className="calendar-items">
                    {selectedDateLogs.map((log) => (
                      <div className="calendar-item" key={log.id}>
                        <div>
                          <strong><Droplets size={14} /> {log.plant_name}</strong>
                          <span>{log.memo || (log.source === "automation" ? "자동급수" : "수동 기록")}</span>
                        </div>
                        <button className="icon-btn danger" onClick={() => deleteWateringLog(log)} title="기록 취소">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    {selectedDateMemos.map((memo) => (
                      <div className="calendar-item memo-item" key={memo.id}>
                        <div>
                          <strong><StickyNote size={14} /> 메모</strong>
                          <span>{memo.content}</span>
                        </div>
                        <button className="icon-btn danger" onClick={() => deleteDayMemo(memo)} title="메모 삭제">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    {selectedDateLogs.length === 0 && selectedDateMemos.length === 0 && (
                      <div className="empty compact-empty">이 날의 기록이 없습니다.</div>
                    )}
                  </div>

                  <form className="form-grid day-add-form" onSubmit={saveDayRecord}>
                    <div className="meta">이 날짜에 기록 추가</div>
                    <div className="check-list compact">
                      {plants.map((plant) => (
                        <label key={plant.id} className="check-chip">
                          <input
                            type="checkbox"
                            checked={bulkLog.plant_names.includes(plant.name)}
                            onChange={() => toggleBulkPlant(plant.name)}
                          />
                          <span>{plant.name}</span>
                        </label>
                      ))}
                    </div>
                    <textarea
                      className="input textarea"
                      placeholder="메모 (식물을 선택하면 급수 기록 메모로, 선택 안 하면 메모만 저장돼요)"
                      value={bulkLog.memo}
                      onChange={(event) => setBulkLog({ ...bulkLog, memo: event.target.value })}
                    />
                    <button className="btn primary" type="submit">
                      <Plus size={16} /> 기록 저장
                    </button>
                  </form>
                </aside>
              </div>
            </section>
          )}

          {activeTab === "photos" && (
            <section className="tab-page photo-layout">
              <div className="panel">
                <div className="panel-title">
                  <h2><Plus size={18} /> 기록 남기기</h2>
                  <span className="meta">사진이든 메모든</span>
                </div>

                <form className="form-grid photo-form" onSubmit={submitPhoto}>
                  <label className="field">
                    <span className="meta">식물 (선택)</span>
                    <select
                      className="select"
                      value={photoDraft.plantId}
                      onChange={(event) => setPhotoDraft({ ...photoDraft, plantId: event.target.value })}
                    >
                      <option value="">특정 식물 아님 (전체 사진 · 일반 메모)</option>
                      {model.map((plant) => (
                        <option key={plant.id} value={plant.id}>{plant.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span className="meta">날짜</span>
                    <input
                      className="input"
                      type="date"
                      max={today}
                      value={photoDraft.capturedAt || today}
                      onChange={(event) =>
                        setPhotoDraft({ ...photoDraft, capturedAt: event.target.value || today })
                      }
                    />
                  </label>

                  <label className="field photo-picker">
                    <span className="meta">사진 (선택)</span>
                    <input
                      ref={photoInputRef}
                      className="input file-input"
                      type="file"
                      accept="image/*"
                      disabled={isBusy("photo-prepare") || isBusy("photo-upload")}
                      onChange={(event) => onPhotoFileChange(event.target.files?.[0] ?? null)}
                    />
                    <span className="hint">
                      폰에서 열면 카메라로 바로 찍을 수 있어요. 올리기 전에 자동으로 크기를 줄입니다.
                      사진 없이 메모만 남겨도 됩니다.
                    </span>
                  </label>

                  <label className="field photo-picker">
                    <span className="meta">메모</span>
                    <textarea
                      className="input textarea"
                      placeholder="오늘 화분 정리함 / 새 화분 들임 / 물 준 뒤 잎이 폈다 …"
                      maxLength={500}
                      value={photoDraft.note}
                      onChange={(event) => setPhotoDraft({ ...photoDraft, note: event.target.value })}
                    />
                  </label>

                  {isBusy("photo-prepare") && <div className="photo-preview-note">사진을 줄이는 중…</div>}

                  {pendingPhoto && (
                    <div className="photo-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pendingPhoto.thumb} alt="선택한 사진 미리보기" />
                      <div className="photo-preview-body">
                        <strong>{pendingPhoto.name}</strong>
                        <span className="meta">약 {Math.round(pendingPhoto.image.length / 1400)}KB로 줄였습니다</span>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setPendingPhoto(null);
                            if (photoInputRef.current) photoInputRef.current.value = "";
                          }}
                        >
                          <X size={14} /> 사진 빼기
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    className="btn primary"
                    type="submit"
                    disabled={isBusy("photo-upload") || isBusy("photo-prepare")}
                  >
                    <Plus size={16} /> {isBusy("photo-upload") ? "저장 중…" : "기록 저장"}
                  </button>
                </form>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2><StickyNote size={18} /> 모아보기</h2>
                  <span className="meta">{photos.length}건</span>
                </div>

                {isBusy("photos") ? (
                  <div className="empty">기록을 불러오는 중입니다.</div>
                ) : photosError ? (
                  <div className="empty">
                    <p>{photosError}</p>
                    <button className="btn sm" onClick={() => reloadPhotos()}>
                      <RefreshCw size={14} /> 다시 시도
                    </button>
                  </div>
                ) : photos.length ? (
                  <div className="photo-grid">
                    {photos.map((photo, index) => (
                      <figure className="photo-card" key={photo.id} style={{ "--i": index } as React.CSSProperties}>
                        {photo.has_image && photo.thumb_url ? (
                          <button className="photo-thumb" onClick={() => openPhoto(photo)} title="크게 보기">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.thumb_url}
                              alt={`${photo.plant_name ?? "전체"} ${photo.captured_at}`}
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          </button>
                        ) : (
                          <div className="photo-thumb note-only">
                            <StickyNote size={20} />
                          </div>
                        )}
                        <figcaption>
                          <div className="photo-caption-main">
                            {photo.plant_id ? (
                              <button
                                type="button"
                                className="plant-open"
                                title={`${photo.plant_name} 기록 보기`}
                                onClick={() => openPlantAnalysis(photo.plant_id as string)}
                              >
                                {photo.plant_name}
                              </button>
                            ) : (
                              <strong className="muted-name">전체</strong>
                            )}
                            <span className="meta">{photo.captured_at}</span>
                          </div>
                          {photo.note && <p>{photo.note}</p>}
                        </figcaption>
                        <button
                          className="icon-btn danger sm photo-delete"
                          title="기록 삭제"
                          disabled={isBusy(`photo:${photo.id}`)}
                          onClick={() => deletePhoto(photo)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <div className="empty">아직 기록이 없습니다. 위에서 첫 기록을 남겨보세요.</div>
                )}
              </div>
            </section>
          )}

          {activeTab === "water" && (
            <section className="tab-page water-layout">
              <div className="panel">
                <div className="panel-title">
                  <h2><Droplets size={18} /> 자동급수 설정</h2>
                  <span className="meta">펌프 기준값을 여기서 정합니다</span>
                </div>

                <p className="hint">
                  자동급수는 연결된 토양센서 값이 기준 아래일 때만 펌프를 돌립니다.
                  센서를 지정하지 않은 식물은 켜 두어도 물이 나가지 않습니다.
                </p>

                <form className="bulk-auto" onSubmit={applyBulkAutomation}>
                  <div className="meta">모든 식물에 같은 값 넣기</div>
                  <div className="bulk-auto-grid">
                    <label>
                      <span>수분 기준 %</span>
                      <input name="moisture_min_pct" type="number" min={MOISTURE_RANGE[0]} max={MOISTURE_RANGE[1]} defaultValue={30} />
                    </label>
                    <label>
                      <span>급수 초</span>
                      <input name="watering_seconds" type="number" step={1} min={SECONDS_RANGE[0]} max={SECONDS_RANGE[1]} defaultValue={5} />
                    </label>
                    <label>
                      <span>쿨다운 시간</span>
                      <input name="cooldown_hours" type="number" step={1} min={COOLDOWN_RANGE[0]} max={COOLDOWN_RANGE[1]} defaultValue={12} />
                    </label>
                    <label>
                      <span>하루 최대</span>
                      <input name="max_runs_per_day" type="number" step={1} min={MAX_RUNS_RANGE[0]} max={MAX_RUNS_RANGE[1]} defaultValue={2} />
                    </label>
                  </div>
                  <button className="btn primary" type="submit" disabled={isBusy("bulk-auto")}>
                    <Droplets size={15} /> {isBusy("bulk-auto") ? "적용 중…" : `${model.length}종에 한 번에 적용`}
                  </button>
                </form>

                <div className="table-scroll">
                  <table className="plant-table water-table">
                    <thead>
                      <tr>
                        <th>식물</th>
                        <th>자동급수</th>
                        <th>토양센서</th>
                        <th>수분 기준 %</th>
                        <th>급수 초</th>
                        <th>쿨다운</th>
                        <th>하루 최대</th>
                        <th>저장</th>
                        <th>펌프</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.map((plant) => (
                        // 값이 바뀌면 줄을 다시 그려 입력칸이 저장된 값을 보여주게 한다.
                        <tr
                          key={`${plant.id}-${plant.moisture_min_pct}-${plant.watering_seconds}-${plant.cooldown_hours}-${plant.max_runs_per_day}`}
                        >
                          <td>
                            <button
                              type="button"
                              className="plant-open"
                              title={`${plant.name} 분석 보기`}
                              onClick={() => openPlantAnalysis(plant.id)}
                            >
                              {plant.name}
                              <ChevronRight size={13} />
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`btn sm ${plant.automation_enabled ? "primary" : ""}`}
                              disabled={isBusy(`auto:${plant.id}`)}
                              onClick={(event) => toggleAutomation(plant, event.currentTarget)}
                            >
                              {plant.automation_enabled ? "켜짐" : "꺼짐"}
                            </button>
                          </td>
                          <td>
                            <select
                              className="select"
                              value={plant.soil_sensor_enabled ? plant.soil_sensor_device_id ?? "" : ""}
                              disabled={isBusy(`sensor:${plant.id}`)}
                              onChange={(event) => connectSoilSensor(plant, event.target.value)}
                            >
                              <option value="">미지정</option>
                              {availableSensorDevices.map((deviceId) => (
                                <option key={deviceId} value={deviceId}>{deviceId}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input name="moisture_min_pct" type="number" min={MOISTURE_RANGE[0]} max={MOISTURE_RANGE[1]} defaultValue={plant.moisture_min_pct ?? 30} />
                          </td>
                          <td>
                            <input name="watering_seconds" type="number" step={1} min={SECONDS_RANGE[0]} max={SECONDS_RANGE[1]} defaultValue={plant.watering_seconds ?? 5} />
                          </td>
                          <td>
                            <input name="cooldown_hours" type="number" step={1} min={COOLDOWN_RANGE[0]} max={COOLDOWN_RANGE[1]} defaultValue={plant.cooldown_hours ?? 12} />
                          </td>
                          <td>
                            <input name="max_runs_per_day" type="number" step={1} min={MAX_RUNS_RANGE[0]} max={MAX_RUNS_RANGE[1]} defaultValue={plant.max_runs_per_day ?? 2} />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={isBusy(`auto:${plant.id}`)}
                              onClick={(event) => saveAutomationFromPanel(plant, event.currentTarget, false)}
                            >
                              저장
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={isBusy(`pump:${plant.id}`)}
                              onClick={() => queuePumpTest(plant)}
                            >
                              테스트
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2><ThermometerSun size={18} /> 실시간 센서</h2>
                  <span className="meta">ESP32 수신값</span>
                </div>
                <div className="sensor-strip">
                  {["베란다"].map((loc) => {
                    const reading = latestByLocation[loc];
                    const age = sensorAgeHours(reading, nowMs);
                    const stale = !isFresh(reading, nowMs);
                    return (
                      <div className={`sensor-card ${reading && stale ? "stale" : ""}`} key={loc}>
                        <div className="sensor-head">
                          {/* 구역 이름은 화면에서 뺐다. 센서가 한 곳뿐이라 구분할 일이 없다. */}
                          <span><Home size={15} /> 센서</span>
                          {reading ? (
                            <span className={`sensor-age ${stale ? "stale" : "live"}`}>
                              {stale ? <AlertTriangle size={12} /> : <Activity size={12} />}
                              {age === null ? "시각 불명" : formatAge(age)}
                              {stale && " · 수신 끊김"}
                            </span>
                          ) : (
                            <span className="meta">대기 중</span>
                          )}
                        </div>
                        <div className="sensor-grid three">
                          <div className="sensor-cell">
                            <div className="sensor-label">온도</div>
                            <div className="sensor-value">{reading ? `${reading.temperature_c}°C` : "-"}</div>
                          </div>
                          <div className="sensor-cell">
                            <div className="sensor-label">습도</div>
                            <div className="sensor-value">{reading ? `${reading.humidity_pct}%` : "-"}</div>
                          </div>
                          <div className="sensor-cell">
                            <div className="sensor-label">조도</div>
                            <div className="sensor-value">{reading ? `${reading.light_lux}lx` : "-"}</div>
                          </div>
                        </div>
                        {reading && stale && (
                          <p className="sensor-note">
                            마지막 수신이 {SENSOR_STALE_HOURS}시간을 넘어 급수 주기 계산에서 제외했습니다.
                            ESP32 전원과 Wi-Fi를 확인하세요.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2><Gauge size={18} /> 토양수분</h2>
                  <span className="meta">센서 연결 {soilPlants.length}종</span>
                </div>
                {soilPlants.length ? (
                  <div className="soil-grid">
                    {soilPlants.map((plant) => {
                      const reading = latestByDevice[plant.soil_sensor_device_id ?? ""];
                      const age = sensorAgeHours(reading, nowMs);
                      const stale = !isFresh(reading, nowMs);
                      const moisture =
                        reading && reading.soil_moisture_pct !== null
                          ? Number(reading.soil_moisture_pct)
                          : null;
                      const level = moisture === null ? "none" : moisture < 20 ? "low" : moisture < 50 ? "mid" : "high";
                      return (
                        <div className={`soil-card ${reading && stale ? "stale" : ""}`} key={plant.id}>
                          <div className="soil-head">
                            <strong>{plant.name}</strong>
                            <span className="meta">{plant.soil_sensor_device_id}</span>
                          </div>
                          <div className="moisture-bar">
                            <div
                              className={`moisture-fill ${level}`}
                              style={{ width: `${Math.min(100, Math.max(0, moisture ?? 0))}%` }}
                            />
                          </div>
                          <div className="soil-foot">
                            <span className={`moisture-val ${level}`}>
                              {moisture === null ? (reading ? "측정 안 함" : "수신 대기") : `${moisture}%`}
                            </span>
                            <span className={`sensor-age ${reading ? (stale ? "stale" : "live") : ""}`}>
                              {reading ? `${age === null ? "시각 불명" : formatAge(age)}${stale ? " · 수신 끊김" : ""}` : "-"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty">토양센서를 연결한 식물이 없습니다. 위 표의 ‘토양센서’ 칸에서 지정하세요.</div>
                )}
              </div>
            </section>
          )}

          {activeTab === "add" && (
            <section className="tab-page">
              <div className="panel add-panel">
                <div className="panel-title">
                  <h2><Plus size={18} /> 새 식물 추가</h2>
                  <span className="meta">이름과 위치만 입력하세요</span>
                </div>
                <form className="form-grid add-form simple" onSubmit={addPlant}>
                  <input className="input" required placeholder="식물 이름" value={newPlant.name} onChange={(event) => setNewPlant({ ...newPlant, name: event.target.value })} />
                  <select className="select" value={newPlant.location} onChange={(event) => setNewPlant({ ...newPlant, location: event.target.value })}>
                    <option value="거실">거실</option>
                    <option value="베란다">베란다</option>
                  </select>
                  <button className="btn primary" type="submit">
                    <CheckCircle size={16} /> 식물 저장
                  </button>
                </form>
                <p className="hint">분류·물 요구량·일조량 등 나머지 정보는 나중에 채워 넣을 수 있어요.</p>
              </div>
            </section>
          )}
        </div>
      </div>

      {lightbox && (
        <div className="modal-backdrop photo-backdrop" onClick={() => setLightbox(null)}>
          <div className="photo-viewer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="photo-viewer-head">
              <div>
                <strong>{lightbox.photo.plant_name}</strong>
                <span className="meta">{lightbox.photo.captured_at}</span>
              </div>
              <button className="icon-btn" title="닫기" onClick={() => setLightbox(null)}><X size={16} /></button>
            </div>
            <div className="photo-viewer-body">
              {lightbox.status === "ready" && lightbox.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={lightbox.imageUrl} alt={`${lightbox.photo.plant_name} ${lightbox.photo.captured_at}`} />
              ) : lightbox.status === "error" ? (
                <div className="empty compact-empty">
                  <p>원본을 불러오지 못했습니다.</p>
                  <button className="btn sm" onClick={() => openPhoto(lightbox.photo)}>
                    <RefreshCw size={14} /> 다시 시도
                  </button>
                </div>
              ) : (
                <div className="empty compact-empty">원본을 불러오는 중입니다.</div>
              )}
            </div>
            {lightbox.photo.note && <p className="photo-viewer-note">{lightbox.photo.note}</p>}
          </div>
        </div>
      )}

      {settingsPlant && (
        <div className="modal-backdrop" onClick={() => setSettingsPlantId(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2><Settings size={18} /> {settingsPlant.name} 설정</h2>
              <button className="icon-btn" onClick={() => setSettingsPlantId(null)}><X size={16} /></button>
            </div>

            <div className="modal-body">
              <label className="sensor-link-row">
                <span>토양센서</span>
                <select
                  value={settingsPlant.soil_sensor_enabled ? settingsPlant.soil_sensor_device_id ?? "" : ""}
                  onChange={(event) => connectSoilSensor(settingsPlant, event.target.value)}
                >
                  <option value="">미지정</option>
                  {availableSensorDevices.map((deviceId) => (
                    <option key={deviceId} value={deviceId}>{deviceId}</option>
                  ))}
                </select>
              </label>

              <p className="hint">
                자동급수 기준과 펌프 테스트는 &lsquo;급수&rsquo; 탭에서 모든 식물을 한 번에 다룹니다.
              </p>

              <button
                className="btn"
                onClick={() => {
                  setSettingsPlantId(null);
                  setActiveTab("water");
                }}
              >
                <Droplets size={15} /> 급수 설정 열기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
