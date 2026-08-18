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
  ImagePlus,
  Leaf,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  Sprout,
  StickyNote,
  Sun,
  ThermometerSun,
  Trash2,
  X,
} from "lucide-react";
import type { DayMemo, Plant, PlantPhoto, SensorReading, WateringLog } from "@/lib/types";

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
const READ_ONLY_KEYS = /^(photos$|photo-open:|photo-prepare$)/;

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

function statusFor(dday: number | null) {
  if (dday === null) return { label: "기록 없음", className: "ok" };
  if (dday < 0) return { label: `${Math.abs(dday)}일 지남`, className: "late" };
  if (dday === 0) return { label: "오늘 물주기", className: "soon" };
  if (dday <= 2) return { label: "곧 물주기", className: "soon" };
  return { label: "여유 있음", className: "ok" };
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
  const today = useMemo(() => formatLocalDate(new Date(nowMs)), [nowMs]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [logs, setLogs] = useState<WateringLog[]>([]);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [memos, setMemos] = useState<DayMemo[]>([]);
  const [photos, setPhotos] = useState<PlantPhoto[]>([]);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [photosError, setPhotosError] = useState("");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<"전체" | "거실" | "베란다">("전체");
  const [sort, setSort] = useState<"priority" | "name">("priority");
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "status" | "analysis" | "calendar" | "memos" | "photos" | "soil" | "add"
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

  async function loadPhotos() {
    // 목록 조회가 늦게 도착해 그 사이의 업로드·삭제를 되돌리지 않게 막는다.
    const seq = ++photoSeq.current;
    const mutationsAtStart = mutationCount.current;
    const data = await fetchJson<{ photos: PlantPhoto[] }>("/api/plant-photos");
    if (seq !== photoSeq.current || mutationsAtStart !== mutationCount.current) return;

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
    run("photos", async () => {
      try {
        await loadPhotos();
      } catch (error) {
        // 빈 목록과 "불러오지 못함"은 다르다. 구분하지 않으면 사진이 없는 줄 안다.
        setPhotosError(error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
        throw error;
      }
    });
  }, [activeTab, photosLoaded]);

  // 촬영일 기본값은 사진 탭을 열 때의 오늘로 둔다.
  useEffect(() => {
    if (activeTab !== "photos") return;
    setPhotoDraft((prev) => (prev.capturedAt ? prev : { ...prev, capturedAt: today }));
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
  const selectedPlant = model.find((plant) => plant.id === selectedPlantId) ?? model[0] ?? null;
  const settingsPlant = model.find((plant) => plant.id === settingsPlantId) ?? null;
  const availableSensorDevices = useMemo(
    () => Array.from(new Set(readings.map((reading) => reading.device_id))).sort(),
    [readings],
  );
  const latestByLocation = useMemo(() => latestBy(readings, (reading) => reading.location), [readings]);
  const latestByDevice = useMemo(() => latestBy(readings, (reading) => reading.device_id), [readings]);
  const soilPlants = useMemo(() => model.filter((plant) => plant.soil_sensor_enabled && plant.soil_sensor_device_id), [model]);
  const filtered = useMemo(() => {
    return model
      .filter((plant) => location === "전체" || plant.location === location)
      .filter((plant) => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return true;
        return [plant.name, plant.category, plant.memo].some((value) =>
          (value ?? "").toLowerCase().includes(keyword),
        );
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name, "ko");
        return (a.dday ?? 999) - (b.dday ?? 999);
      });
  }, [model, location, query, sort]);

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

  async function quickWater(plant: PlantModel) {
    await run(`water:${plant.id}`, async () => {
      const data = await fetchJson<{ log: WateringLog }>("/api/watering-logs", {
        method: "POST",
        body: JSON.stringify({ plant_name: plant.name, watered_at: today, memo: "대시보드 물주기" }),
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

  async function cancelTodayWatering(plant: PlantModel) {
    const todayLog = [...plant.logs].reverse().find((log) => log.watered_at.slice(0, 10) === today);
    if (!todayLog) {
      window.alert("오늘 취소할 급수 기록이 없습니다.");
      return;
    }
    await deleteWateringLog(todayLog);
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

    if (!photoDraft.plantId) {
      window.alert("어떤 식물의 사진인지 골라주세요.");
      return;
    }
    if (!pendingPhoto) {
      window.alert("사진을 먼저 선택해주세요.");
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
          plant_id: photoDraft.plantId,
          image_url: pendingPhoto.image,
          thumb_url: pendingPhoto.thumb,
          note: photoDraft.note.trim(),
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
      setPendingPhoto(null);
      setPhotoDraft((prev) => ({ ...prev, note: "" }));
      if (photoInputRef.current) photoInputRef.current.value = "";
    });
  }

  async function deletePhoto(photo: PlantPhoto) {
    const ok = window.confirm(`${photo.plant_name}의 ${photo.captured_at} 사진을 삭제할까요?`);
    if (!ok) return;

    await run(`photo:${photo.id}`, async () => {
      await fetchJson<{ deleted: { id: string } }>(`/api/plant-photos/${photo.id}`, { method: "DELETE" });
      setPhotos((prev) => prev.filter((item) => item.id !== photo.id));
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

  async function toggleAutomation(plant: Plant) {
    await run(`auto:${plant.id}`, () => updateAutomation(plant, { enabled: !plant.automation_enabled }));
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

  async function saveAutomationFromPanel(plant: Plant, target: HTMLElement) {
    const panel = target.closest(".automation-grid");
    const readNumber = (name: string, fallback: number, min: number, max: number) => {
      const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      // 빈 칸이면 Number("")가 0이 되어 DB 제약을 위반하던 문제가 있어 명시적으로 걸러낸다.
      const raw = input?.value.trim();
      const parsed = raw ? Number(raw) : NaN;
      const value = Number.isFinite(parsed) ? parsed : fallback;
      return Math.min(max, Math.max(min, value));
    };

    await run(`auto:${plant.id}`, async () => {
      await updateAutomation(plant, {
        moisture_min_pct: readNumber("moisture_min_pct", plant.moisture_min_pct ?? 30, ...MOISTURE_RANGE),
        watering_seconds: readNumber("watering_seconds", plant.watering_seconds ?? 5, ...SECONDS_RANGE),
        cooldown_hours: readNumber("cooldown_hours", plant.cooldown_hours ?? 12, ...COOLDOWN_RANGE),
        max_runs_per_day: readNumber("max_runs_per_day", plant.max_runs_per_day ?? 2, ...MAX_RUNS_RANGE),
      });
      window.alert("자동급수 설정을 저장했습니다.");
    });
  }

  async function applyTestAutomation(plant: Plant, target: HTMLElement) {
    const panel = target.closest(".automation-grid");
    // cooldown_hours는 DB 제약이 1시간 이상이라 0을 넣으면 저장이 실패한다.
    const values = { moisture_min_pct: 30, watering_seconds: 5, cooldown_hours: 1, max_runs_per_day: 5 };

    Object.entries(values).forEach(([name, value]) => {
      const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input) input.value = String(value);
    });

    await run(`auto:${plant.id}`, async () => {
      await updateAutomation(plant, values);
      window.alert("테스트 설정을 저장했습니다. 다음 센서 POST에서 펌프 명령을 확인하세요.");
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

  const analysisGaps = selectedPlant ? wateringGaps(selectedPlant.logs) : [];
  const maxGap = Math.max(1, ...analysisGaps.map((item) => item.gap));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div>
            <div className="eyebrow">
              <Sprout size={16} />
              Plant IoT
            </div>
            <h1>J&apos;s Smart Farm</h1>
          </div>
          <div className="actions">
            <button className="btn" onClick={loadAll} disabled={loading}>
              <RefreshCw size={16} />
              새로고침
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
          <button className={`navitem ${activeTab === "memos" ? "active" : ""}`} onClick={() => setActiveTab("memos")}>
            <StickyNote size={17} /> 메모
          </button>
          <button className={`navitem ${activeTab === "photos" ? "active" : ""}`} onClick={() => setActiveTab("photos")}>
            <Camera size={17} /> 사진
          </button>
          <button className={`navitem ${activeTab === "soil" ? "active" : ""}`} onClick={() => setActiveTab("soil")}>
            <Gauge size={17} /> 토양수분
          </button>
          <button className={`navitem ${activeTab === "add" ? "active" : ""}`} onClick={() => setActiveTab("add")}>
            <Plus size={17} /> 새 식물
          </button>
        </aside>

        <div className="content-col">
          {error && <div className="error">{error}</div>}

          {(activeTab === "dashboard" || activeTab === "status") && (
          <section className="stats">
            <div className="stat stat-danger">
              <div className="stat-ico"><AlertTriangle size={20} /></div>
              <div className="stat-main">
                <div className="stat-label">위험 · 이미 늦음</div>
                <div className="stat-value">{overdue}<em>건</em></div>
              </div>
              <p className="stat-detail">{listPlantNames(dangerPlants)}</p>
            </div>
            <div className="stat stat-today">
              <div className="stat-ico"><Droplets size={20} /></div>
              <div className="stat-main">
                <div className="stat-label">오늘 물줘야 함</div>
                <div className="stat-value">{dueToday}<em>건</em></div>
              </div>
              <p className="stat-detail">{listPlantNames(todayPlants)}</p>
            </div>
            <div className="stat stat-soon">
              <div className="stat-ico"><Clock size={20} /></div>
              <div className="stat-main">
                <div className="stat-label">곧 물줘야 함</div>
                <div className="stat-value">{soon}<em>건</em></div>
              </div>
              <p className="stat-detail">{listPlantNames(soonPlants)}</p>
            </div>
            <div className="stat">
              <div className="stat-ico"><CheckCircle size={20} /></div>
              <div className="stat-main">
                <div className="stat-label">오늘 완료</div>
                <div className="stat-value">{wateredToday}<em>건</em></div>
              </div>
              <p className="stat-detail">총 {model.length}종 관리 중</p>
            </div>
          </section>
          )}

          {activeTab === "dashboard" && (
            <section className="dash">
              <section className="panel sensor-panel">
                <div className="panel-title">
                  <h2><ThermometerSun size={18} /> 실시간 센서</h2>
                  <span className="meta">ESP32 수신값</span>
                </div>
                <div className="sensor-strip">
                  {["베란다", "거실"].map((loc) => {
                    const reading = latestByLocation[loc];
                    const age = sensorAgeHours(reading, nowMs);
                    const stale = !isFresh(reading, nowMs);
                    return (
                      <div className={`sensor-card ${reading && stale ? "stale" : ""}`} key={loc}>
                        <div className="sensor-head">
                          <span><Home size={15} /> {loc}</span>
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
              </section>

              <div className="filters">
                <label>
                  <span className="meta">검색</span>
                  <div style={{ position: "relative" }}>
                    <Search size={16} style={{ left: 12, position: "absolute", top: 13, color: "#a8a29e" }} />
                    <input className="input" style={{ paddingLeft: 36 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="식물명, 분류, 메모 검색" />
                  </div>
                </label>
                <label>
                  <span className="meta">구역</span>
                  <select className="select" value={location} onChange={(event) => setLocation(event.target.value as typeof location)}>
                    <option value="전체">전체</option>
                    <option value="거실">거실</option>
                    <option value="베란다">베란다</option>
                  </select>
                </label>
                <label>
                  <span className="meta">정렬</span>
                  <select className="select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                    <option value="priority">우선순위</option>
                    <option value="name">이름순</option>
                  </select>
                </label>
              </div>

              {loading ? (
                <div className="empty">DB에서 데이터를 불러오는 중입니다.</div>
              ) : filtered.length === 0 ? (
                <div className="empty">표시할 식물이 없습니다. ‘새 식물’ 메뉴에서 추가해보세요.</div>
              ) : (
                <div className="plant-grid">
                  {filtered.map((plant) => {
                    const status = statusFor(plant.dday);
                    const wateredTodayThis = plant.logs.some((log) => log.watered_at.slice(0, 10) === today);
                    const daysSince = plant.lastWatered ? dateDiff(today, plant.lastWatered) : null;
                    return (
                      <article className={`pcard tone-${status.className}`} key={plant.id}>
                        <div className="pcard-top">
                          <div className="pcard-title">
                            <h3>{plant.name}</h3>
                            <div className="tags">
                              <span className="tag">{plant.category || "분류 없음"}</span>
                              <span className="tag">{plant.location}</span>
                              {plant.automation_enabled && <span className="tag auto">자동급수</span>}
                            </div>
                          </div>
                          <span className={`status ${status.className}`}>{status.label}</span>
                        </div>

                        <div className="pcard-metrics">
                          <div className="pmetric">
                            <span className="meta">마지막 급수</span>
                            <strong>{plant.lastWatered ?? "기록 없음"}</strong>
                            <span className="pmetric-sub">
                              {daysSince === null ? " " : daysSince === 0 ? "오늘" : `${daysSince}일 전`}
                            </span>
                          </div>
                          <div className="pmetric">
                            <span className="meta">다음 예정</span>
                            <strong>{plant.nextDue ?? "-"}</strong>
                            <span className="pmetric-sub">
                              {plant.dday === null
                                ? " "
                                : plant.dday === 0
                                  ? "오늘"
                                  : plant.dday > 0
                                    ? `${plant.dday}일 남음`
                                    : `${Math.abs(plant.dday)}일 지남`}
                            </span>
                          </div>
                          <div className="pmetric">
                            <span className="meta">분석 주기</span>
                            <strong>{plant.interval}일</strong>
                            <span className="pmetric-sub">
                              {plant.learnedInterval ? "기록 학습" : "기본값"}
                            </span>
                          </div>
                        </div>

                        <div className="pcard-meta">
                          <span><Sun size={13} /> {plant.sunlight || "일조 정보 없음"}</span>
                          <span><CalendarDays size={13} /> 급수 {plant.logs.length}회</span>
                        </div>

                        <div className="pcard-actions">
                          {wateredTodayThis ? (
                            <button
                              className="btn sm"
                              disabled={isBusy(`water:${plant.id}`)}
                              onClick={() => cancelTodayWatering(plant)}
                            >
                              <Droplets size={14} /> 물주기 취소
                            </button>
                          ) : (
                            <button
                              className="btn sm primary"
                              disabled={isBusy(`water:${plant.id}`)}
                              onClick={() => quickWater(plant)}
                            >
                              <Droplets size={14} /> 물주기
                            </button>
                          )}
                          <button
                            className="btn sm"
                            disabled={isBusy(`auto:${plant.id}`)}
                            onClick={() => toggleAutomation(plant)}
                          >
                            <Power size={14} /> {plant.automation_enabled ? "자동 끄기" : "자동 켜기"}
                          </button>
                          <button className="icon-btn sm" title="설정" onClick={() => setSettingsPlantId(plant.id)}>
                            <Settings size={14} />
                          </button>
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
                        <th>알림</th>
                        <th>식물</th>
                        <th>분류</th>
                        <th>위치</th>
                        <th>물 선호도</th>
                        <th>햇빛 선호도</th>
                        <th>마지막 물준 날</th>
                        <th>지난일수</th>
                        <th>평균주기</th>
                        <th>분석주기</th>
                        <th>다음예정일</th>
                        <th>D-day</th>
                        <th>상태</th>
                        <th>메모</th>
                        <th>기록수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.map((plant) => {
                        const status = statusFor(plant.dday);
                        return (
                          <tr key={plant.id}>
                            <td><span className={`dot ${status.className}`} /></td>
                            <td>{plant.name}</td>
                            <td>{plant.category || "-"}</td>
                            <td>{plant.location}</td>
                            <td>{plant.water_level}</td>
                            <td>{plant.sunlight || "-"}</td>
                            <td>{plant.lastWatered ?? "-"}</td>
                            <td>{plant.lastWatered ? dateDiff(today, plant.lastWatered) : "-"}</td>
                            <td>{plant.learnedInterval ?? "-"}</td>
                            <td>{plant.interval}</td>
                            <td>{plant.nextDue ?? "-"}</td>
                            <td>{plant.dday ?? "-"}</td>
                            <td>{status.label}</td>
                            <td>{plant.care_note || plant.memo || "-"}</td>
                            <td>{plant.logs.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeTab === "analysis" && (
            <section className="tab-page analysis-layout">
              <div className="panel">
                <div className="panel-title">
                  <h2><Activity size={18} /> 식물 분석</h2>
                  <span className="meta">{model.length}종</span>
                </div>
                <div className="plant-list">
                  {model.map((plant) => {
                    const status = statusFor(plant.dday);
                    return (
                      <button
                        key={plant.id}
                        className={`plant-list-item ${selectedPlant?.id === plant.id ? "active" : ""}`}
                        onClick={() => setSelectedPlantId(plant.id)}
                      >
                        <span>{plant.name}</span>
                        <span className={`status ${status.className}`}>{status.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedPlant && (
                <div className="panel">
                  <div className="panel-title">
                    <h2>{selectedPlant.name}</h2>
                    <span className="meta">{selectedPlant.location}</span>
                  </div>

                  <div className="analysis-cards">
                    <div className="metric"><span className="meta">총 급수</span><strong>{selectedPlant.logs.length}회</strong></div>
                    <div className="metric"><span className="meta">최근 평균</span><strong>{selectedPlant.learnedInterval ?? "-"}일</strong></div>
                    <div className="metric"><span className="meta">분석 주기</span><strong>{selectedPlant.interval}일</strong></div>
                    <div className="metric"><span className="meta">다음 예정</span><strong>{selectedPlant.nextDue ?? "-"}</strong></div>
                  </div>

                  <div className="chart-block">
                    <div className="chart-title">급수 간격(일) 추이</div>
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
              )}
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
                      const count = logsByDate[day.date]?.length ?? 0;
                      const memoCount = memosByDate[day.date]?.length ?? 0;
                      return (
                        <button
                          className={`day-cell ${day.inMonth ? "" : "muted"} ${selectedDate === day.date ? "selected" : ""} ${day.date === today ? "today" : ""}`}
                          key={day.date}
                          onClick={() => setSelectedDate(day.date)}
                        >
                          <span className="day-num">{Number(day.date.slice(-2))}</span>
                          {memoCount > 0 && <span className="diary-mark">📝</span>}
                          {count > 0 && <strong>💧 {count}</strong>}
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
                          <strong>💧 {log.plant_name}</strong>
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
                          <strong>📝 메모</strong>
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

          {activeTab === "memos" && (
            <section className="tab-page">
              <div className="panel">
                <div className="panel-title">
                  <h2><StickyNote size={18} /> 메모 모아보기</h2>
                  <span className="meta">{memos.length}건</span>
                </div>
                {memos.length ? (
                  <div className="calendar-items log-list">
                    {memos.map((memo) => (
                      <div className="calendar-item memo-item" key={memo.id}>
                        <div>
                          <strong>{memo.entry_date}</strong>
                          <span>{memo.content}</span>
                        </div>
                        <button className="icon-btn danger" onClick={() => deleteDayMemo(memo)} title="메모 삭제">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">아직 메모가 없습니다. 급수 캘린더에서 날짜를 고르고 메모를 적어보세요.</div>
                )}
              </div>
            </section>
          )}

          {activeTab === "photos" && (
            <section className="tab-page photo-layout">
              <div className="panel">
                <div className="panel-title">
                  <h2><ImagePlus size={18} /> 사진 올리기</h2>
                  <span className="meta">{photos.length}장 기록됨</span>
                </div>

                <form className="form-grid photo-form" onSubmit={submitPhoto}>
                  <label className="field">
                    <span className="meta">식물</span>
                    <select
                      className="select"
                      value={photoDraft.plantId}
                      onChange={(event) => setPhotoDraft({ ...photoDraft, plantId: event.target.value })}
                    >
                      <option value="">선택하세요</option>
                      {model.map((plant) => (
                        <option key={plant.id} value={plant.id}>{plant.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span className="meta">촬영일</span>
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
                    <span className="meta">사진</span>
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
                    </span>
                  </label>

                  <label className="field">
                    <span className="meta">메모</span>
                    <input
                      className="input"
                      value={photoDraft.note}
                      placeholder="새 잎이 났어요"
                      maxLength={500}
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
                          <X size={14} /> 선택 해제
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    className="btn primary"
                    type="submit"
                    disabled={isBusy("photo-upload") || isBusy("photo-prepare")}
                  >
                    <Camera size={16} /> {isBusy("photo-upload") ? "올리는 중…" : "사진 저장"}
                  </button>
                </form>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2><Camera size={18} /> 사진 기록</h2>
                  <span className="meta">{photos.length}장</span>
                </div>

                {isBusy("photos") ? (
                  <div className="empty">사진을 불러오는 중입니다.</div>
                ) : photosError ? (
                  <div className="empty">
                    <p>{photosError}</p>
                    <button
                      className="btn sm"
                      onClick={() => {
                        setPhotosError("");
                        run("photos", loadPhotos);
                      }}
                    >
                      <RefreshCw size={14} /> 다시 시도
                    </button>
                  </div>
                ) : photos.length ? (
                  <div className="photo-grid">
                    {photos.map((photo) => (
                      <figure className="photo-card" key={photo.id}>
                        <button className="photo-thumb" onClick={() => openPhoto(photo)} title="크게 보기">
                          {photo.thumb_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={photo.thumb_url} alt={`${photo.plant_name} ${photo.captured_at}`} loading="lazy" />
                          ) : (
                            <span className="photo-missing"><Camera size={20} /></span>
                          )}
                        </button>
                        <figcaption>
                          <div className="photo-caption-main">
                            <strong>{photo.plant_name}</strong>
                            <span className="meta">{photo.captured_at}</span>
                          </div>
                          {photo.note && <p>{photo.note}</p>}
                        </figcaption>
                        <button
                          className="icon-btn danger sm photo-delete"
                          title="사진 삭제"
                          disabled={isBusy(`photo:${photo.id}`)}
                          onClick={() => deletePhoto(photo)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <div className="empty">아직 올린 사진이 없습니다. 위에서 첫 사진을 올려보세요.</div>
                )}
              </div>
            </section>
          )}

          {activeTab === "soil" && (
            <section className="tab-page">
              <div className="panel">
                <div className="panel-title">
                  <h2><Gauge size={18} /> 토양수분 모니터링</h2>
                  <span className="meta">토양센서 연결 식물 {soilPlants.length}종</span>
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
                  <div className="empty">토양센서가 연결된 식물이 없습니다. 식물 카드의 ⚙ 설정에서 토양센서를 지정하세요.</div>
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

              <button className="btn" disabled={isBusy(`auto:${settingsPlant.id}`)} onClick={() => toggleAutomation(settingsPlant)}>
                <Power size={15} /> 자동급수 {settingsPlant.automation_enabled ? "끄기" : "켜기"}
              </button>

              {settingsPlant.automation_enabled ? (
                <>
                  {(() => {
                    // 자동급수는 연결된 토양센서의 실측값이 기준 아래일 때만 명령을 만든다.
                    // 센서가 없거나 값을 안 보내면 켜놔도 영원히 물이 나가지 않는다.
                    const linked = settingsPlant.soil_sensor_enabled && settingsPlant.soil_sensor_device_id;
                    const reading = linked ? latestByDevice[settingsPlant.soil_sensor_device_id!] : undefined;
                    const hasMoisture = reading != null && reading.soil_moisture_pct !== null;
                    if (linked && hasMoisture) return null;
                    return (
                      <p className="warn-note">
                        <AlertTriangle size={14} />
                        {linked
                          ? "연결된 센서가 토양수분을 보내지 않고 있어 자동급수가 실행되지 않습니다."
                          : "토양센서를 지정해야 자동급수가 실행됩니다. 지금은 켜져 있어도 물이 나가지 않습니다."}
                      </p>
                    );
                  })()}
                  <div className="automation-grid">
                    <label>
                      <span>수분 기준 %</span>
                      <input name="moisture_min_pct" type="number" min={MOISTURE_RANGE[0]} max={MOISTURE_RANGE[1]} defaultValue={settingsPlant.moisture_min_pct ?? 30} />
                    </label>
                    <label>
                      <span>급수 초</span>
                      <input name="watering_seconds" type="number" min={SECONDS_RANGE[0]} max={SECONDS_RANGE[1]} defaultValue={settingsPlant.watering_seconds ?? 5} />
                    </label>
                    <label>
                      <span>쿨다운 시간</span>
                      <input name="cooldown_hours" type="number" min={COOLDOWN_RANGE[0]} max={COOLDOWN_RANGE[1]} defaultValue={settingsPlant.cooldown_hours ?? 12} />
                    </label>
                    <label>
                      <span>하루 최대</span>
                      <input name="max_runs_per_day" type="number" min={MAX_RUNS_RANGE[0]} max={MAX_RUNS_RANGE[1]} defaultValue={settingsPlant.max_runs_per_day ?? 2} />
                    </label>
                    <button type="button" className="btn sm" disabled={isBusy(`auto:${settingsPlant.id}`)} onClick={(event) => saveAutomationFromPanel(settingsPlant, event.currentTarget)}>
                      설정 저장
                    </button>
                    <button type="button" className="btn sm" disabled={isBusy(`auto:${settingsPlant.id}`)} onClick={(event) => applyTestAutomation(settingsPlant, event.currentTarget)}>
                      테스트값 적용
                    </button>
                  </div>
                  <button type="button" className="btn primary" disabled={isBusy(`pump:${settingsPlant.id}`)} onClick={() => queuePumpTest(settingsPlant)}>
                    펌프 테스트 5초
                  </button>
                </>
              ) : (
                <p className="hint">‘자동급수 켜기’를 누르면 펌프/수분 기준을 설정할 수 있어요.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
