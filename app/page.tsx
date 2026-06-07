"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  Gauge,
  Home,
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
import type { DayMemo, Plant, SensorReading, WateringLog } from "@/lib/types";

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
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [memos, setMemos] = useState<DayMemo[]>([]);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<"전체" | "거실" | "베란다">("전체");
  const [sort, setSort] = useState<"priority" | "name">("priority");
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "status" | "analysis" | "calendar" | "memos" | "soil" | "add"
  >("dashboard");
  const [selectedPlantId, setSelectedPlantId] = useState("");
  const [settingsPlantId, setSettingsPlantId] = useState<string | null>(null);
  const [newPlant, setNewPlant] = useState(blankPlant);
  const [bulkLog, setBulkLog] = useState({ plant_names: [] as string[], memo: "" });
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAll() {
    setError("");
    setLoading(true);

    try {
      const [plantsData, logsData, sensorData, memoData] = await Promise.all([
        fetchJson<{ plants: Plant[] }>("/api/plants"),
        fetchJson<{ logs: WateringLog[] }>("/api/watering-logs"),
        fetchJson<{ readings: SensorReading[] }>("/api/sensor-readings"),
        fetchJson<{ memos: DayMemo[] }>("/api/day-memos"),
      ]);
      setPlants(plantsData.plants);
      setLogs(logsData.logs);
      setReadings(sensorData.readings);
      setMemos(memoData.memos);
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
  const settingsPlant = model.find((plant) => plant.id === settingsPlantId) ?? null;
  const availableSensorDevices = useMemo(() => Array.from(new Set(readings.map((reading) => reading.device_id))), [readings]);
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
    const data = await fetchJson<{ plant: Plant }>("/api/plants", {
      method: "POST",
      body: JSON.stringify({ name: newPlant.name, location: newPlant.location }),
    });
    setPlants((prev) => [...prev, data.plant]);
    setNewPlant(blankPlant);
    setActiveTab("dashboard");
  }

  async function deletePlant(plant: Plant) {
    const ok = window.confirm(`'${plant.name}' 식물을 삭제할까요?\n관련 설정도 함께 삭제됩니다.`);
    if (!ok) return;

    await fetchJson<{ deleted: Plant }>(`/api/plants/${plant.id}`, { method: "DELETE" });
    setPlants((prev) => prev.filter((item) => item.id !== plant.id));
    if (settingsPlantId === plant.id) setSettingsPlantId(null);
  }

  async function saveDayRecord(event: FormEvent) {
    event.preventDefault();
    const hasPlants = bulkLog.plant_names.length > 0;
    const memo = bulkLog.memo.trim();

    if (!hasPlants && !memo) {
      window.alert("식물을 선택하거나, 메모를 입력해주세요.");
      return;
    }

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
  }

  function toggleBulkPlant(plantName: string) {
    setBulkLog((prev) => ({
      ...prev,
      plant_names: prev.plant_names.includes(plantName)
        ? prev.plant_names.filter((name) => name !== plantName)
        : [...prev.plant_names, plantName],
    }));
  }

  async function quickWater(plantName: string) {
    const data = await fetchJson<{ log: WateringLog }>("/api/watering-logs", {
      method: "POST",
      body: JSON.stringify({ plant_name: plantName, watered_at: today, memo: "대시보드 물주기" }),
    });
    setLogs((prev) => [data.log, ...prev]);
  }

  async function deleteWateringLog(log: WateringLog) {
    const ok = window.confirm(`${log.watered_at.slice(0, 10)} ${log.plant_name} 급수 기록을 취소할까요?`);
    if (!ok) return;

    await fetchJson<{ deleted: WateringLog }>(`/api/watering-logs/${log.id}`, { method: "DELETE" });
    setLogs((prev) => prev.filter((item) => item.id !== log.id));
  }

  async function cancelTodayWatering(plant: PlantModel) {
    const todayLog = [...plant.logs].reverse().find((log) => log.watered_at.slice(0, 10) === today);
    if (!todayLog) {
      window.alert("오늘 취소할 급수 기록이 없습니다.");
      return;
    }
    await deleteWateringLog(todayLog);
  }

  async function deleteDayMemo(memo: DayMemo) {
    const ok = window.confirm("이 메모를 삭제할까요?");
    if (!ok) return;

    await fetchJson<{ deleted: DayMemo }>(`/api/day-memos/${memo.id}`, { method: "DELETE" });
    setMemos((prev) => prev.filter((item) => item.id !== memo.id));
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
    const values = { moisture_min_pct: 30, watering_seconds: 5, cooldown_hours: 0, max_runs_per_day: 5 };

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

  async function connectSoilSensor(plant: Plant, sensorDeviceId: string) {
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
          <button className={`navitem ${activeTab === "soil" ? "active" : ""}`} onClick={() => setActiveTab("soil")}>
            <Gauge size={17} /> 토양수분
          </button>
          <button className={`navitem ${activeTab === "add" ? "active" : ""}`} onClick={() => setActiveTab("add")}>
            <Plus size={17} /> 새 식물
          </button>
        </aside>

        <div className="content-col">
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

          {activeTab === "dashboard" && (
            <section className="dash">
              {error && <div className="error">{error}</div>}

              <section className="panel sensor-panel">
                <div className="panel-title">
                  <h2><ThermometerSun size={18} /> 실시간 센서</h2>
                  <span className="meta">ESP32 수신값</span>
                </div>
                <div className="sensor-strip">
                  {["베란다", "거실"].map((loc) => {
                    const reading = readings.find((item) => item.location === loc);
                    return (
                      <div className="sensor-card" key={loc}>
                        <div className="sensor-head">
                          <span><Home size={15} /> {loc}</span>
                          <span className="meta">{reading ? new Date(reading.recorded_at).toLocaleString("ko-KR") : "대기 중"}</span>
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
                      <article className="pcard" key={plant.id}>
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
                            <span className="meta">급수 경과</span>
                            <strong>{daysSince === null ? "기록 없음" : daysSince === 0 ? "오늘" : `${daysSince}일 전`}</strong>
                          </div>
                          <div className="pmetric">
                            <span className="meta">다음 예정</span>
                            <strong>{plant.nextDue ?? "-"}</strong>
                          </div>
                          <div className="pmetric">
                            <span className="meta">분석 주기</span>
                            <strong>{plant.interval}일</strong>
                          </div>
                        </div>

                        <div className="pcard-meta">
                          <span><CalendarDays size={13} /> 최근 급수 {plant.lastWatered ?? "없음"}</span>
                          <span><Sun size={13} /> {plant.sunlight || "정보 없음"}</span>
                        </div>

                        <div className="pcard-actions">
                          {wateredTodayThis ? (
                            <button className="btn sm" onClick={() => cancelTodayWatering(plant)}>
                              <Droplets size={14} /> 물주기 취소
                            </button>
                          ) : (
                            <button className="btn sm primary" onClick={() => quickWater(plant.name)}>
                              <Droplets size={14} /> 물주기
                            </button>
                          )}
                          <button className="btn sm" onClick={() => toggleAutomation(plant)}>
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
                        {analysisGaps.map((item) => (
                          <div className="bar-col" key={item.date} title={`${item.date} · 직전 급수와 ${item.gap}일 간격`}>
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
                      const reading = readings.find((item) => item.device_id === plant.soil_sensor_device_id);
                      const moisture = reading ? Number(reading.soil_moisture_pct) : null;
                      const level = moisture === null ? "none" : moisture < 20 ? "low" : moisture < 50 ? "mid" : "high";
                      return (
                        <div className="soil-card" key={plant.id}>
                          <div className="soil-head">
                            <strong>{plant.name}</strong>
                            <span className="meta">{plant.soil_sensor_device_id}</span>
                          </div>
                          <div className="moisture-bar">
                            <div className={`moisture-fill ${level}`} style={{ width: `${moisture ?? 0}%` }} />
                          </div>
                          <div className="soil-foot">
                            <span className={`moisture-val ${level}`}>{moisture === null ? "수신 대기" : `${moisture}%`}</span>
                            <span className="meta">{reading ? new Date(reading.recorded_at).toLocaleString("ko-KR") : "-"}</span>
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

      {settingsPlant && (
        <div className="modal-backdrop" onClick={() => setSettingsPlantId(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
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

              <button className="btn" onClick={() => toggleAutomation(settingsPlant)}>
                <Power size={15} /> 자동급수 {settingsPlant.automation_enabled ? "끄기" : "켜기"}
              </button>

              {settingsPlant.automation_enabled ? (
                <>
                  <div className="automation-grid">
                    <label>
                      <span>수분 기준 %</span>
                      <input name="moisture_min_pct" type="number" min="1" max="100" defaultValue={settingsPlant.moisture_min_pct ?? 30} />
                    </label>
                    <label>
                      <span>급수 초</span>
                      <input name="watering_seconds" type="number" min="1" max="20" defaultValue={settingsPlant.watering_seconds ?? 5} />
                    </label>
                    <label>
                      <span>쿨다운 시간</span>
                      <input name="cooldown_hours" type="number" min="0" max="168" defaultValue={settingsPlant.cooldown_hours ?? 12} />
                    </label>
                    <label>
                      <span>하루 최대</span>
                      <input name="max_runs_per_day" type="number" min="1" max="20" defaultValue={settingsPlant.max_runs_per_day ?? 2} />
                    </label>
                    <button type="button" className="btn sm" onClick={(event) => saveAutomationFromPanel(settingsPlant, event.currentTarget)}>
                      설정 저장
                    </button>
                    <button type="button" className="btn sm" onClick={(event) => applyTestAutomation(settingsPlant, event.currentTarget)}>
                      테스트값 적용
                    </button>
                  </div>
                  <button type="button" className="btn primary" onClick={() => queuePumpTest(settingsPlant)}>
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
