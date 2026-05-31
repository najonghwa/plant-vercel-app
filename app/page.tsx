"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  CalendarDays,
  Droplets,
  Home,
  Leaf,
  Plus,
  RefreshCw,
  Search,
  Sprout,
  Sun,
  ThermometerSun,
} from "lucide-react";
import type { Plant, SensorReading, WateringLog } from "@/lib/types";

type PlantModel = Plant & {
  logs: string[];
  lastWatered: string | null;
  interval: number;
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

function buildPlantModel(plants: Plant[], logs: WateringLog[], today: string) {
  const byPlant = logs.reduce<Record<string, string[]>>((acc, log) => {
    acc[log.plant_name] = [...(acc[log.plant_name] ?? []), log.watered_at.slice(0, 10)];
    return acc;
  }, {});

  return plants.map<PlantModel>((plant) => {
    const dates = (byPlant[plant.name] ?? []).sort();
    const gaps = dates
      .slice(1)
      .map((date, index) => dateDiff(date, dates[index]))
      .filter((gap) => gap > 0);
    const learnedInterval = mean(gaps.slice(-6));
    const interval = Math.round(learnedInterval ?? estimateBaseInterval(plant.water_level));
    const lastWatered = dates.at(-1) ?? null;
    const nextDue = lastWatered ? addDays(lastWatered, interval) : null;

    return {
      ...plant,
      logs: dates,
      lastWatered,
      interval,
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
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<"전체" | "거실" | "베란다">("전체");
  const [sort, setSort] = useState<"priority" | "name">("priority");
  const [newPlant, setNewPlant] = useState(blankPlant);
  const [newLog, setNewLog] = useState({ plant_name: "", watered_at: today, memo: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAll() {
    setError("");
    setLoading(true);

    try {
      const [plantsData, logsData, sensorData] = await Promise.all([
        fetchJson<{ plants: Plant[] }>("/api/plants"),
        fetchJson<{ logs: WateringLog[] }>("/api/watering-logs"),
        fetchJson<{ readings: SensorReading[] }>("/api/sensor-readings"),
      ]);
      setPlants(plantsData.plants);
      setLogs(logsData.logs);
      setReadings(sensorData.readings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const model = useMemo(() => buildPlantModel(plants, logs, today), [plants, logs, today]);
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
    const data = await fetchJson<{ log: WateringLog }>("/api/watering-logs", {
      method: "POST",
      body: JSON.stringify(newLog),
    });
    setLogs((prev) => [data.log, ...prev]);
    setNewLog({ plant_name: "", watered_at: today, memo: "" });
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

  async function toggleAutomation(plant: Plant) {
    const enabled = !plant.automation_enabled;
    const config = await fetchJson<{ config: Partial<Plant> }>(`/api/plants/${plant.id}/automation`, {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        pump_device_id: plant.pump_device_id ?? (plant.location === "베란다" ? "pump-balcony-01" : "pump-living-01"),
        moisture_min_pct: plant.moisture_min_pct ?? 30,
        watering_seconds: plant.watering_seconds ?? 5,
        cooldown_hours: plant.cooldown_hours ?? 12,
        max_runs_per_day: plant.max_runs_per_day ?? 2,
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
        <div className="stat">
          <div className="stat-label">총 관리 식물</div>
          <div className="stat-value">{model.length}종</div>
        </div>
        <div className="stat">
          <div className="stat-label">오늘 급수</div>
          <div className="stat-value">{wateredToday}건</div>
        </div>
        <div className="stat">
          <div className="stat-label">지연 / 오늘</div>
          <div className="stat-value">{overdue + dueToday}건</div>
        </div>
        <div className="stat">
          <div className="stat-label">2일 이내 예정</div>
          <div className="stat-value">{soon}건</div>
        </div>
      </section>

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
                return (
                  <article className="card" key={plant.id}>
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
                        <span className="meta">권장 주기</span>
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

                    <p className="memo">
                      자동급수: {plant.automation_enabled ? "사용" : "미사용"}
                      {plant.automation_enabled
                        ? ` · ${plant.pump_device_id ?? "pump"} · 수분 ${plant.moisture_min_pct ?? 30}% 미만 · ${plant.watering_seconds ?? 5}초`
                        : ""}
                    </p>

                    <button className="btn primary" onClick={() => quickWater(plant.name)}>
                      <Droplets size={16} />
                      오늘 물주기 완료
                    </button>
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
                <Plus size={18} /> 새 식물
              </h2>
            </div>
            <form className="form-grid" onSubmit={addPlant}>
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
              <label className="meta">
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
                />{" "}
                이 식물을 자동급수 대상으로 저장
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
                <Leaf size={16} />
                DB에 식물 저장
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>
                <CalendarDays size={18} /> 급수 기록
              </h2>
            </div>
            <form className="form-grid" onSubmit={addWateringLog}>
              <select className="select" required value={newLog.plant_name} onChange={(event) => setNewLog({ ...newLog, plant_name: event.target.value })}>
                <option value="">식물 선택</option>
                {plants.map((plant) => (
                  <option key={plant.id} value={plant.name}>
                    {plant.name}
                  </option>
                ))}
              </select>
              <input className="input" type="date" value={newLog.watered_at} onChange={(event) => setNewLog({ ...newLog, watered_at: event.target.value })} />
              <input className="input" placeholder="메모" value={newLog.memo} onChange={(event) => setNewLog({ ...newLog, memo: event.target.value })} />
              <button className="btn primary" type="submit">
                <Activity size={16} />
                DB에 급수 기록 저장
              </button>
            </form>
          </section>
        </aside>
      </section>
    </main>
  );
}
