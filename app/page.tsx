"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  CalendarDays,
  CheckCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Home,
  Image as ImageIcon,
  Leaf,
  Plus,
  RefreshCw,
  Search,
  Sprout,
  Sun,
  ThermometerSun,
  Trash2,
} from "lucide-react";
import type { Plant, PlantPhoto, SensorReading, WateringLog } from "@/lib/types";

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
  category: "관엽",
  location: "거실",
  water_level: "보통",
  sunlight: "밝은 간접광",
  memo: "",
  automation_enabled: false,
  pump_device_id: "pump-living-01",
  moisture_min_pct: 30,
  watering_seconds: 5,
  cooldown_hours: 12,
  max_runs_per_day: 2,
};

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

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

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

    if (environmentReading.light_lux >= 900) {
      adjustment -= 1;
      reasons.push(`조도 ${environmentReading.light_lux}lx로 높아 증산량 가산`);
    } else if (environmentReading.light_lux <= 180) {
      adjustment += 1;
      reasons.push(`조도 ${environmentReading.light_lux}lx로 낮아 물 소모 완화`);
    }
  } else {
    reasons.push("해당 구역 온습도/조도 센서값이 없어 기록 기반 주기를 우선 사용");
  }

  if (soilReading) {
    if (soilReading.soil_moisture_pct <= 28) {
      adjustment -= 2;
      reasons.push(`연결 토양수분 ${soilReading.soil_moisture_pct}%로 낮아 우선 확인 권장`);
    } else if (soilReading.soil_moisture_pct >= 65) {
      adjustment += 2;
      reasons.push(`연결 토양수분 ${soilReading.soil_moisture_pct}%로 높아 과습 주의`);
    }
  } else {
    reasons.push("식물에 연결된 토양수분 센서가 없어 환경/기록 기반으로 판단");
  }

  if (plant.water_level.includes("자주")) {
    adjustment -= 1;
    reasons.push("식물 물 요구가 높은 편");
  } else if (plant.water_level.includes("적게")) {
    adjustment += 1;
    reasons.push("식물 물 요구가 낮은 편");
  }

  return { adjustment, reasons };
}

function buildPlantModel(plants: Plant[], logs: WateringLog[], readings: SensorReading[], today: string) {
  const byPlant = logs.reduce<Record<string, WateringLog[]>>((acc, log) => {
    acc[log.plant_name] = [...(acc[log.plant_name] ?? []), log];
    return acc;
  }, {});
  const readingByLocation = readings.reduce<Record<string, SensorReading>>((acc, reading) => {
    acc[reading.location] = reading;
    return acc;
  }, {});
  const readingByDevice = readings.reduce<Record<string, SensorReading>>((acc, reading) => {
    acc[reading.device_id] = reading;
    return acc;
  }, {});

  return plants.map<PlantModel>((plant) => {
    const plantLogs = (byPlant[plant.name] ?? []).sort((a, b) =>
      a.watered_at.localeCompare(b.watered_at),
    );
    const dates = plantLogs.map((log) => log.watered_at.slice(0, 10));
    const gaps = dates
      .slice(1)
      .map((date, index) => dateDiff(date, dates[index]))
      .filter((gap) => gap > 0);
    const learnedIntervalRaw = mean(gaps.slice(-6));
    const learnedInterval = learnedIntervalRaw ? Math.round(learnedIntervalRaw) : null;
    const baseInterval = learnedInterval ?? estimateBaseInterval(plant.water_level);
    const environmentReading = readingByLocation[plant.location];
    const soilReading =
      plant.soil_sensor_enabled && plant.soil_sensor_device_id
        ? readingByDevice[plant.soil_sensor_device_id]
        : undefined;
    const environment = environmentAdjustmentFor(plant, environmentReading, soilReading, today);
    const interval = Math.max(2, Math.min(30, baseInterval + environment.adjustment));
    const lastWatered = dates.at(-1) ?? null;
    const nextDue = lastWatered ? addDays(lastWatered, interval) : null;
    const recommendationReasons = [
      learnedInterval
        ? `최근 급수 간격 평균 ${learnedInterval}일을 반영`
        : `기록이 부족해 기본 주기 ${baseInterval}일을 사용`,
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

function compactPlantNames(plants: PlantModel[]) {
  if (!plants.length) return "없음";
  return plants.slice(0, 4).map((plant) => plant.name).join(", ") + (plants.length > 4 ? ` 외 ${plants.length - 4}` : "");
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
  const today = useMemo(() => formatLocalDate(new Date()), []);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [logs, setLogs] = useState<WateringLog[]>([]);
  const [photos, setPhotos] = useState<PlantPhoto[]>([]);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<"전체" | "거실" | "베란다">("전체");
  const [sort, setSort] = useState<"priority" | "name">("priority");
  const [activeTab, setActiveTab] = useState<"dashboard" | "status" | "analysis" | "logs" | "calendar" | "add" | "photos">("dashboard");
  const [selectedPlantId, setSelectedPlantId] = useState("");
  const [newPlant, setNewPlant] = useState(blankPlant);
  const [newLog, setNewLog] = useState({ plant_name: "", watered_at: today, memo: "" });
  const [bulkLog, setBulkLog] = useState({ plant_names: [] as string[], watered_at: today, memo: "" });
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [photoForm, setPhotoForm] = useState({ plant_id: "", image_url: "", note: "", captured_at: today });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAll() {
    setError("");
    setLoading(true);

    try {
      const [plantsData, logsData, sensorData, photoData] = await Promise.all([
        fetchJson<{ plants: Plant[] }>("/api/plants"),
        fetchJson<{ logs: WateringLog[] }>("/api/watering-logs"),
        fetchJson<{ readings: SensorReading[] }>("/api/sensor-readings"),
        fetchJson<{ photos: PlantPhoto[] }>("/api/plant-photos"),
      ]);
      setPlants(plantsData.plants);
      setLogs(logsData.logs);
      setReadings(sensorData.readings);
      setPhotos(photoData.photos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const model = useMemo(() => buildPlantModel(plants, logs, readings, today), [plants, logs, readings, today]);
  const selectedPlant = model.find((plant) => plant.id === selectedPlantId) ?? model[0] ?? null;
  const availableSensorDevices = useMemo(() => Array.from(new Set(readings.map((reading) => reading.device_id))), [readings]);
  const filtered = useMemo(() => {
    return model
      .filter((plant) => location === "전체" || plant.location === location)
      .filter((plant) => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return true;
        return [plant.name, plant.category, plant.memo].some((value) =>
          value.toLowerCase().includes(keyword),
        );
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name, "ko");
        return (a.dday ?? 999) - (b.dday ?? 999);
      });
  }, [model, location, query, sort]);

  const wateredToday = logs.filter((log) => log.watered_at.slice(0, 10) === today).length;
  const overdue = model.filter((plant) => plant.dday !== null && plant.dday < 0).length;
  const dueToday = model.filter((plant) => plant.dday === 0).length;
  const soon = model.filter((plant) => plant.dday !== null && plant.dday > 0 && plant.dday <= 2).length;
  const dangerPlants = model.filter((plant) => plant.dday !== null && plant.dday < 0);
  const todayPlants = model.filter((plant) => plant.dday === 0);
  const soonPlants = model.filter((plant) => plant.dday !== null && plant.dday > 0 && plant.dday <= 2);
  const logsByDate = useMemo(() => {
    return logs.reduce<Record<string, WateringLog[]>>((acc, log) => {
      const date = log.watered_at.slice(0, 10);
      acc[date] = [...(acc[date] ?? []), log];
      return acc;
    }, {});
  }, [logs]);

  const photosByPlant = useMemo(() => {
    return photos.reduce<Record<string, PlantPhoto[]>>((acc, photo) => {
      acc[photo.plant_id] = [...(acc[photo.plant_id] ?? []), photo];
      return acc;
    }, {});
  }, [photos]);

  const monthDays = useMemo(() => getMonthDays(calendarMonth), [calendarMonth]);
  const selectedDateLogs = logsByDate[selectedDate] ?? [];

  async function addPlant(event: FormEvent) {
    event.preventDefault();
    const data = await fetchJson<{ plant: Plant }>("/api/plants", {
      method: "POST",
      body: JSON.stringify(newPlant),
    });
    setPlants((prev) => [...prev, data.plant]);
    setNewPlant(blankPlant);
  }

  async function addWateringLog(event: FormEvent) {
    event.preventDefault();
    const plantNames = bulkLog.plant_names.length ? bulkLog.plant_names : [newLog.plant_name].filter(Boolean);
    const wateredAt = bulkLog.plant_names.length ? bulkLog.watered_at : newLog.watered_at;
    const memo = bulkLog.plant_names.length ? bulkLog.memo : newLog.memo;

    if (!plantNames.length) {
      window.alert("급수 기록을 저장할 식물을 선택해주세요.");
      return;
    }

    const data = await fetchJson<{ log: WateringLog; logs: WateringLog[] }>("/api/watering-logs", {
      method: "POST",
      body: JSON.stringify({ plant_names: plantNames, watered_at: wateredAt, memo }),
    });
    setLogs((prev) => [...data.logs, ...prev]);
    setNewLog({ plant_name: "", watered_at: today, memo: "" });
    setBulkLog({ plant_names: [], watered_at: today, memo: "" });
  }

  async function addWateringToSelectedDate(event: FormEvent) {
    event.preventDefault();
    if (!bulkLog.plant_names.length) {
      window.alert("추가할 식물을 선택해주세요.");
      return;
    }

    const data = await fetchJson<{ logs: WateringLog[] }>("/api/watering-logs", {
      method: "POST",
      body: JSON.stringify({
        plant_names: bulkLog.plant_names,
        watered_at: selectedDate,
        memo: bulkLog.memo,
      }),
    });
    setLogs((prev) => [...data.logs, ...prev]);
    setBulkLog({ plant_names: [], watered_at: today, memo: "" });
  }

  function toggleBulkPlant(plantName: string) {
    setBulkLog((prev) => ({
      ...prev,
      plant_names: prev.plant_names.includes(plantName)
        ? prev.plant_names.filter((name) => name !== plantName)
        : [...prev.plant_names, plantName],
    }));
  }

  async function addPlantPhoto(event: FormEvent) {
    event.preventDefault();
    const data = await fetchJson<{ photo: PlantPhoto }>("/api/plant-photos", {
      method: "POST",
      body: JSON.stringify(photoForm),
    });
    setPhotos((prev) => [data.photo, ...prev]);
    setPhotoForm({ plant_id: "", image_url: "", note: "", captured_at: today });
  }

  async function quickWater(plantName: string) {
    const alreadyDone = logs.some(
      (log) => log.plant_name === plantName && log.watered_at.slice(0, 10) === today,
    );

    if (alreadyDone) {
      window.alert(`${plantName}은(는) 이미 오늘 물 준 기록이 있습니다.`);
      return;
    }

    const data = await fetchJson<{ log: WateringLog }>("/api/watering-logs", {
      method: "POST",
      body: JSON.stringify({ plant_name: plantName, watered_at: today, memo: "대시보드 퀵 물주기" }),
    });
    setLogs((prev) => [data.log, ...prev]);
  }

  async function deleteWateringLog(log: WateringLog) {
    const ok = window.confirm(`${log.watered_at.slice(0, 10)} ${log.plant_name} 급수 기록을 취소할까요?`);
    if (!ok) return;

    await fetchJson<{ deleted: WateringLog }>(`/api/watering-logs/${log.id}`, {
      method: "DELETE",
    });
    setLogs((prev) => prev.filter((item) => item.id !== log.id));
  }

  async function cancelTodayWatering(plant: PlantModel) {
    const todayLog = [...plant.logs]
      .reverse()
      .find((log) => log.watered_at.slice(0, 10) === today);

    if (!todayLog) {
      window.alert("오늘 취소할 급수 기록이 없습니다.");
      return;
    }

    await deleteWateringLog(todayLog);
  }

  async function toggleAutomation(plant: Plant) {
    await updateAutomation(plant, { enabled: !plant.automation_enabled });
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
    const balcony = "\uBCA0\uB780\uB2E4";
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
        item.id === plant.id
          ? {
              ...item,
              ...config.config,
              automation_enabled: enabled,
            }
          : item,
      ),
    );
  }

  async function saveAutomationFromPanel(plant: Plant, target: HTMLElement) {
    const panel = target.closest(".automation-grid");
    const readNumber = (name: string, fallback: number) => {
      const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      return Number(input?.value ?? fallback);
    };

    await updateAutomation(plant, {
      moisture_min_pct: readNumber("moisture_min_pct", plant.moisture_min_pct ?? 30),
      watering_seconds: readNumber("watering_seconds", plant.watering_seconds ?? 5),
      cooldown_hours: readNumber("cooldown_hours", plant.cooldown_hours ?? 12),
      max_runs_per_day: readNumber("max_runs_per_day", plant.max_runs_per_day ?? 2),
    });
    window.alert("자동급수 설정을 저장했습니다.");
  }

  async function applyTestAutomation(plant: Plant, target: HTMLElement) {
    const panel = target.closest(".automation-grid");
    const values = {
      moisture_min_pct: 30,
      watering_seconds: 5,
      cooldown_hours: 0,
      max_runs_per_day: 5,
    };

    Object.entries(values).forEach(([name, value]) => {
      const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input) input.value = String(value);
    });

    await updateAutomation(plant, values);
    window.alert("테스트 설정을 저장했습니다. 다음 센서 POST에서 펌프 명령을 확인하세요.");
  }

  async function queuePumpTest(plant: Plant) {
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
  }

  async function connectSoilSensor(plant: PlantModel, sensorDeviceId: string) {
    const enabled = Boolean(sensorDeviceId);
    const data = await fetchJson<{ config: Partial<Plant> }>(`/api/plants/${plant.id}/sensor`, {
      method: "PUT",
      body: JSON.stringify({
        soil_sensor_enabled: enabled,
        soil_sensor_device_id: sensorDeviceId,
      }),
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
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div>
            <div className="eyebrow">
              <Sprout size={16} />
              Plant IoT Dashboard
            </div>
            <h1>식물 물주기 스마트 작전판</h1>
            <p className="sub">Postgres DB 저장, Vercel API, ESP32 센서 수신을 붙인 운영형 대시보드입니다.</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={loadAll} disabled={loading}>
              <RefreshCw size={16} />
              새로고침
            </button>
          </div>
        </div>
      </header>

      <section className="wrap stats">
        <div className="stat stat-danger">
          <div className="stat-label">위험 · 이미 늦음</div>
          <div className="stat-value">{overdue}건</div>
          <p className="stat-detail">{compactPlantNames(dangerPlants)}</p>
        </div>
        <div className="stat stat-today">
          <div className="stat-label">오늘 물줘야 함</div>
          <div className="stat-value">{dueToday}건</div>
          <p className="stat-detail">{compactPlantNames(todayPlants)}</p>
        </div>
        <div className="stat stat-soon">
          <div className="stat-label">곧 물줘야 함</div>
          <div className="stat-value">{soon}건</div>
          <p className="stat-detail">{compactPlantNames(soonPlants)}</p>
        </div>
        <div className="stat">
          <div className="stat-label">오늘 완료</div>
          <div className="stat-value">{wateredToday}건</div>
          <p className="stat-detail">총 {model.length}종 관리 중</p>
        </div>
      </section>

      <nav className="wrap tabs">
        <button className={`tab ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
          <Leaf size={16} />
          관리판
        </button>
        <button className={`tab ${activeTab === "status" ? "active" : ""}`} onClick={() => setActiveTab("status")}>
          <BarChart3 size={16} />
          전체 현황
        </button>
        <button className={`tab ${activeTab === "analysis" ? "active" : ""}`} onClick={() => setActiveTab("analysis")}>
          <Activity size={16} />
          식물 분석
        </button>
        <button className={`tab ${activeTab === "logs" ? "active" : ""}`} onClick={() => setActiveTab("logs")}>
          <Droplets size={16} />
          전체 로그
        </button>
        <button className={`tab ${activeTab === "calendar" ? "active" : ""}`} onClick={() => setActiveTab("calendar")}>
          <CalendarDays size={16} />
          급수 캘린더
        </button>
        <button className={`tab ${activeTab === "add" ? "active" : ""}`} onClick={() => setActiveTab("add")}>
          <Plus size={16} />
          새 식물
        </button>
        <button className={`tab ${activeTab === "photos" ? "active" : ""}`} onClick={() => setActiveTab("photos")}>
          <ImageIcon size={16} />
          사진 기록
        </button>
      </nav>

      {activeTab === "dashboard" && (
      <section className="wrap content">
        <div>
          {error && <div className="error">{error}</div>}

          <div className="filters">
            <label>
              <span className="meta">검색</span>
              <div style={{ position: "relative" }}>
                <Search size={16} style={{ left: 12, position: "absolute", top: 13, color: "#a8a29e" }} />
                <input
                  className="input"
                  style={{ paddingLeft: 36 }}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="식물명, 분류, 메모 검색"
                />
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
          ) : (
            <div className="grid">
              {filtered.map((plant) => {
                const status = statusFor(plant.dday);
                const latestPhoto = photosByPlant[plant.id]?.[0];
                return (
                  <article className="card" key={plant.id}>
                    {latestPhoto && (
                      <img className="plant-photo" src={latestPhoto.image_url} alt={`${plant.name} 최근 사진`} />
                    )}
                    <div className="card-head">
                      <div>
                        <h3>{plant.name}</h3>
                        <div className="tags">
                          <span className="tag">{plant.category || "분류 없음"}</span>
                          <span className="tag">{plant.location}</span>
                        </div>
                      </div>
                      <span className={`status ${status.className}`}>{status.label}</span>
                    </div>

                    <div className="metrics">
                      <div className="metric">
                        <span className="meta">최근 급수</span>
                        <strong>{plant.lastWatered ?? "없음"}</strong>
                      </div>
                      <div className="metric">
                        <span className="meta">분석 주기</span>
                        <strong>{plant.interval}일</strong>
                      </div>
                      <div className="metric">
                        <span className="meta">총 이력</span>
                        <strong>{plant.logs.length}회</strong>
                      </div>
                    </div>

                    <div className="meta">
                      <Droplets size={14} /> 물 요구: {plant.water_level}
                      <br />
                      <Sun size={14} /> 일조량: {plant.sunlight || "정보 없음"}
                    </div>

                    {plant.memo && <p className="memo">{plant.memo}</p>}

                    <div className="analysis-box">
                      <div className="analysis-head">
                        <strong>추천 근거</strong>
                        <span>{plant.environmentAdjustment === 0 ? "환경 보정 없음" : `환경 보정 ${plant.environmentAdjustment > 0 ? "+" : ""}${plant.environmentAdjustment}일`}</span>
                      </div>
                      <ul>
                        {plant.recommendationReasons.slice(0, 3).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>

                    <p className="memo">
                      자동급수: {plant.automation_enabled ? "사용" : "미사용"}
                      {plant.automation_enabled
                        ? ` · ${plant.pump_device_id ?? "pump"} · 수분 ${plant.moisture_min_pct ?? 30}% 미만 · ${plant.watering_seconds ?? 5}초`
                        : ""}
                    </p>

                    {plant.automation_enabled && (
                      <div className="automation-grid">
                        <label>
                          <span>수분 기준 %</span>
                          <input
                            name="moisture_min_pct"
                            type="number"
                            min="1"
                            max="100"
                            defaultValue={plant.moisture_min_pct ?? 30}
                          />
                        </label>
                        <label>
                          <span>급수 초</span>
                          <input
                            name="watering_seconds"
                            type="number"
                            min="1"
                            max="20"
                            defaultValue={plant.watering_seconds ?? 5}
                          />
                        </label>
                        <label>
                          <span>쿨다운 시간</span>
                          <input
                            name="cooldown_hours"
                            type="number"
                            min="0"
                            max="168"
                            defaultValue={plant.cooldown_hours ?? 12}
                          />
                        </label>
                        <label>
                          <span>하루 최대</span>
                          <input
                            name="max_runs_per_day"
                            type="number"
                            min="1"
                            max="20"
                            defaultValue={plant.max_runs_per_day ?? 2}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn"
                          onClick={(event) => saveAutomationFromPanel(plant, event.currentTarget)}
                        >
                          자동급수 설정 저장
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={(event) => applyTestAutomation(plant, event.currentTarget)}
                        >
                          테스트 설정 적용
                        </button>
                      </div>
                    )}

                    <label className="sensor-link-row">
                      <span>토양센서</span>
                      <select
                        value={plant.soil_sensor_enabled ? plant.soil_sensor_device_id ?? "" : ""}
                        onChange={(event) => connectSoilSensor(plant, event.target.value)}
                      >
                        <option value="">미지정</option>
                        {availableSensorDevices.map((deviceId) => (
                          <option key={deviceId} value={deviceId}>{deviceId}</option>
                        ))}
                      </select>
                    </label>

                    <button className="btn primary" onClick={() => quickWater(plant.name)}>
                      <Droplets size={16} />
                      오늘 물주기 완료
                    </button>
                    {plant.automation_enabled && (
                      <button className="btn" onClick={() => queuePumpTest(plant)}>
                        펌프 테스트 5초
                      </button>
                    )}
                    {plant.logs.some((log) => log.watered_at.slice(0, 10) === today) && (
                      <button className="btn danger" onClick={() => cancelTodayWatering(plant)}>
                        <Trash2 size={16} />
                        오늘 기록 취소
                      </button>
                    )}
                    <button className="btn" onClick={() => toggleAutomation(plant)}>
                      {plant.automation_enabled ? "자동급수 끄기" : "자동급수 대상으로 지정"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="side">
          <section className="panel">
            <div className="panel-title">
              <h2>
                <ThermometerSun size={18} /> ESP32 센서
              </h2>
              <button className="btn" onClick={loadAll}>
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="sensor-list">
              {["베란다", "거실"].map((loc) => {
                const reading = readings.find((item) => item.location === loc);
                return (
                  <div className="sensor-card" key={loc}>
                    <div className="sensor-head">
                      <span>
                        <Home size={15} /> {loc}
                      </span>
                      <span className="meta">{reading ? new Date(reading.recorded_at).toLocaleString("ko-KR") : "대기 중"}</span>
                    </div>
                    <div className="sensor-grid">
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
                      <div className="sensor-cell">
                        <div className="sensor-label">토양수분</div>
                        <div className="sensor-value">{reading ? `${reading.soil_moisture_pct}%` : "-"}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>
                <CalendarDays size={18} /> 급수 기록
              </h2>
            </div>
            <form className="form-grid" onSubmit={addWateringLog}>
              <input className="input" type="date" value={bulkLog.watered_at} onChange={(event) => setBulkLog({ ...bulkLog, watered_at: event.target.value })} />
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
              <input className="input" placeholder="메모" value={bulkLog.memo} onChange={(event) => setBulkLog({ ...bulkLog, memo: event.target.value })} />
              <button className="btn primary" type="submit">
                <Activity size={16} />
                선택한 식물 급수 기록 저장
              </button>
            </form>
          </section>
        </aside>
      </section>
      )}

      {activeTab === "status" && (
        <section className="wrap tab-page">
          <div className="panel table-panel">
            <div className="panel-title">
              <h2>
                <BarChart3 size={18} /> 전체 식물 현황
              </h2>
              <span className="meta">분석 주기와 환경 추천 포함</span>
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
                    <th>난이도</th>
                    <th>토양센서</th>
                    <th>온도</th>
                    <th>습도</th>
                    <th>환경추천</th>
                    <th>메모</th>
                    <th>기록수</th>
                  </tr>
                </thead>
                <tbody>
                  {model.map((plant) => {
                    const status = statusFor(plant.dday);
                    const locationReading = readings.find((reading) => reading.location === plant.location);
                    return (
                      <tr key={plant.id}>
                        <td><span className={`dot ${status.className}`} /></td>
                        <td>{plant.name}</td>
                        <td>{plant.category}</td>
                        <td>{plant.location}</td>
                        <td>{plant.water_level}</td>
                        <td>{plant.sunlight}</td>
                        <td>{plant.lastWatered ?? "-"}</td>
                        <td>{plant.lastWatered ? dateDiff(today, plant.lastWatered) : "-"}</td>
                        <td>{plant.learnedInterval ?? "-"}</td>
                        <td>{plant.interval}</td>
                        <td>{plant.nextDue ?? "-"}</td>
                        <td>{plant.dday ?? "-"}</td>
                        <td>{status.label}</td>
                        <td>{plant.difficulty || "-"}</td>
                        <td>{plant.soil_sensor_enabled ? plant.soil_sensor_device_id : "-"}</td>
                        <td>{locationReading ? `${locationReading.temperature_c}°C` : "-"}</td>
                        <td>{locationReading ? `${locationReading.humidity_pct}%` : "-"}</td>
                        <td>{plant.environment_recommendation || "-"}</td>
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
        <section className="wrap tab-page analysis-layout">
          <div className="panel">
            <div className="panel-title">
              <h2>
                <Activity size={18} /> 식물별 기록/분석
              </h2>
            </div>
            <select className="select" value={selectedPlant?.id ?? ""} onChange={(event) => setSelectedPlantId(event.target.value)}>
              {model.map((plant) => (
                <option key={plant.id} value={plant.id}>{plant.name}</option>
              ))}
            </select>
            {selectedPlant && (
              <div className="analysis-cards">
                <div className="metric"><span className="meta">총 급수</span><strong>{selectedPlant.logs.length}회</strong></div>
                <div className="metric"><span className="meta">최근 평균</span><strong>{selectedPlant.learnedInterval ?? "-"}일</strong></div>
                <div className="metric"><span className="meta">분석 주기</span><strong>{selectedPlant.interval}일</strong></div>
                <div className="metric"><span className="meta">다음 예정</span><strong>{selectedPlant.nextDue ?? "-"}</strong></div>
              </div>
            )}
          </div>
          {selectedPlant && (
            <div className="panel">
              <div className="panel-title">
                <h2>{selectedPlant.name} 분석 근거</h2>
                <span className="meta">{selectedPlant.difficulty || "난이도 미입력"}</span>
              </div>
              <div className="analysis-box standalone">
                <ul>
                  {selectedPlant.recommendationReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
              <div className="calendar-items log-list">
                {selectedPlant.logs.slice().reverse().map((log) => (
                  <div className="calendar-item" key={log.id}>
                    <div>
                      <strong>{log.watered_at.slice(0, 10)}</strong>
                      <span>{log.memo || log.source}</span>
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

      {activeTab === "logs" && (
        <section className="wrap tab-page">
          <div className="panel">
            <div className="panel-title">
              <h2>
                <Droplets size={18} /> 전체 급수 로그
              </h2>
              <span className="meta">{logs.length}건</span>
            </div>
            <div className="calendar-items log-list">
              {logs.map((log) => (
                <div className="calendar-item" key={log.id}>
                  <div>
                    <strong>{log.watered_at.slice(0, 10)} · {log.plant_name}</strong>
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
        <section className="wrap tab-page">
          <div className="calendar-layout">
          <div className="panel calendar-panel">
            <div className="panel-title">
              <h2>
                <CalendarDays size={18} /> 급수 캘린더
              </h2>
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
              {monthDays.map((day) => (
                <button
                  className={`day-cell ${day.inMonth ? "" : "muted"} ${selectedDate === day.date ? "selected" : ""}`}
                  key={day.date}
                  onClick={() => setSelectedDate(day.date)}
                >
                  <span>{Number(day.date.slice(-2))}</span>
                  {(logsByDate[day.date]?.length ?? 0) > 0 && (
                    <strong>{logsByDate[day.date].length}건</strong>
                  )}
                </button>
              ))}
            </div>
          </div>

          <aside className="panel day-detail">
            <div className="panel-title">
              <h2>{selectedDate}</h2>
              <span className="meta">{selectedDateLogs.length}건</span>
            </div>

            <div className="calendar-items">
              {selectedDateLogs.length ? (
                selectedDateLogs.map((log) => (
                  <div className="calendar-item" key={log.id}>
                    <div>
                      <strong>{log.plant_name}</strong>
                      <span>{log.memo || (log.source === "automation" ? "자동급수" : "수동 기록")}</span>
                    </div>
                    <button className="icon-btn danger" onClick={() => deleteWateringLog(log)} title="기록 취소">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty compact-empty">이 날의 급수 기록이 없습니다.</div>
              )}
            </div>

            <form className="form-grid day-add-form" onSubmit={addWateringToSelectedDate}>
              <div className="meta">이 날짜에 식물 추가 기록</div>
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
              <input className="input" placeholder="메모" value={bulkLog.memo} onChange={(event) => setBulkLog({ ...bulkLog, memo: event.target.value })} />
              <button className="btn primary" type="submit">
                <Plus size={16} />
                선택 식물 추가
              </button>
            </form>
          </aside>
          </div>
        </section>
      )}

      {activeTab === "add" && (
        <section className="wrap tab-page">
          <div className="panel add-panel">
            <div className="panel-title">
              <h2>
                <Plus size={18} /> 새 식물 추가
              </h2>
              <span className="meta">저장하면 바로 DB에 들어갑니다.</span>
            </div>
            <form className="form-grid add-form" onSubmit={addPlant}>
              <input className="input" required placeholder="식물 이름" value={newPlant.name} onChange={(event) => setNewPlant({ ...newPlant, name: event.target.value })} />
              <select
                className="select"
                value={newPlant.location}
                onChange={(event) =>
                  setNewPlant({
                    ...newPlant,
                    location: event.target.value,
                    pump_device_id: event.target.value === "베란다" ? "pump-balcony-01" : "pump-living-01",
                  })
                }
              >
                <option value="거실">거실</option>
                <option value="베란다">베란다</option>
              </select>
              <input className="input" placeholder="분류" value={newPlant.category} onChange={(event) => setNewPlant({ ...newPlant, category: event.target.value })} />
              <input className="input" placeholder="물 요구" value={newPlant.water_level} onChange={(event) => setNewPlant({ ...newPlant, water_level: event.target.value })} />
              <input className="input" placeholder="일조량" value={newPlant.sunlight} onChange={(event) => setNewPlant({ ...newPlant, sunlight: event.target.value })} />
              <input className="input" placeholder="메모" value={newPlant.memo} onChange={(event) => setNewPlant({ ...newPlant, memo: event.target.value })} />
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={newPlant.automation_enabled}
                  onChange={(event) =>
                    setNewPlant({
                      ...newPlant,
                      automation_enabled: event.target.checked,
                      pump_device_id: newPlant.location === "베란다" ? "pump-balcony-01" : "pump-living-01",
                    })
                  }
                />
                <span>이 식물을 자동급수 대상으로 저장</span>
              </label>
              {newPlant.automation_enabled && (
                <>
                  <input className="input" placeholder="펌프 장치 ID" value={newPlant.pump_device_id} onChange={(event) => setNewPlant({ ...newPlant, pump_device_id: event.target.value })} />
                  <input className="input" type="number" min="1" max="100" placeholder="급수 시작 토양수분 %" value={newPlant.moisture_min_pct} onChange={(event) => setNewPlant({ ...newPlant, moisture_min_pct: Number(event.target.value) })} />
                  <input className="input" type="number" min="1" max="30" placeholder="펌프 작동 초" value={newPlant.watering_seconds} onChange={(event) => setNewPlant({ ...newPlant, watering_seconds: Number(event.target.value) })} />
                  <input className="input" type="number" min="1" max="168" placeholder="재급수 대기 시간" value={newPlant.cooldown_hours} onChange={(event) => setNewPlant({ ...newPlant, cooldown_hours: Number(event.target.value) })} />
                </>
              )}
              <button className="btn primary" type="submit">
                <CheckCircle size={16} />
                DB에 식물 저장
              </button>
            </form>
          </div>
        </section>
      )}

      {activeTab === "photos" && (
        <section className="wrap tab-page photo-layout">
          <div className="panel add-panel">
            <div className="panel-title">
              <h2>
                <ImageIcon size={18} /> 사진 기록 추가
              </h2>
              <span className="meta">지금은 이미지 URL 저장 방식입니다.</span>
            </div>
            <form className="form-grid add-form" onSubmit={addPlantPhoto}>
              <select className="select" required value={photoForm.plant_id} onChange={(event) => setPhotoForm({ ...photoForm, plant_id: event.target.value })}>
                <option value="">식물 선택</option>
                {plants.map((plant) => (
                  <option key={plant.id} value={plant.id}>{plant.name}</option>
                ))}
              </select>
              <input className="input" type="date" value={photoForm.captured_at} onChange={(event) => setPhotoForm({ ...photoForm, captured_at: event.target.value })} />
              <input className="input" required placeholder="사진 URL" value={photoForm.image_url} onChange={(event) => setPhotoForm({ ...photoForm, image_url: event.target.value })} />
              <input className="input" placeholder="사진 메모" value={photoForm.note} onChange={(event) => setPhotoForm({ ...photoForm, note: event.target.value })} />
              <button className="btn primary" type="submit">
                <CheckCircle size={16} />
                사진 기록 저장
              </button>
            </form>
          </div>

          <div className="photo-grid">
            {photos.map((photo) => (
              <article className="photo-card" key={photo.id}>
                <img src={photo.image_url} alt={`${photo.plant_name} 사진`} />
                <div>
                  <strong>{photo.plant_name}</strong>
                  <span>{photo.captured_at}</span>
                  {photo.note && <p>{photo.note}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
