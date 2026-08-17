export type Plant = {
  id: string;
  name: string;
  category: string;
  location: "거실" | "베란다";
  water_level: string;
  sunlight: string;
  memo: string;
  difficulty?: string;
  environment_recommendation?: string;
  care_note?: string;
  soil_sensor_enabled?: boolean;
  soil_sensor_device_id?: string | null;
  automation_enabled?: boolean;
  pump_device_id?: string | null;
  moisture_min_pct?: number | null;
  watering_seconds?: number | null;
  cooldown_hours?: number | null;
  max_runs_per_day?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type WateringLog = {
  id: string;
  plant_id: string | null;
  plant_name: string;
  watered_at: string;
  memo: string;
  source: "manual" | "automation" | "import";
  created_at?: string;
};

export type SensorReading = {
  id: string;
  location: "거실" | "베란다";
  device_id: string;
  temperature_c: number;
  humidity_pct: number;
  light_lux: number;
  /** null은 "토양센서 없음/측정 안 함". 0은 "완전히 말랐음"이라 의미가 다르다. */
  soil_moisture_pct: number | null;
  recorded_at: string;
};

export type PumpCommand = {
  id: string;
  plant_id: string | null;
  plant_name: string;
  location: "거실" | "베란다";
  pump_device_id: string;
  watering_seconds: number;
  reason: string;
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  requested_at: string;
  completed_at: string | null;
};

export type DayMemo = {
  id: string;
  entry_date: string;
  content: string;
  created_at?: string;
};

export type PlantPhoto = {
  id: string;
  plant_id: string;
  plant_name: string;
  /** 목록 응답에는 썸네일만 실린다. 원본은 /api/plant-photos/[id]로 따로 가져온다. */
  thumb_url: string | null;
  note: string;
  captured_at: string;
  created_at: string;
};
