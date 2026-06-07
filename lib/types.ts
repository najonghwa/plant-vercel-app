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
  soil_moisture_pct: number;
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

export type DiaryEntry = {
  id: string;
  plant_id: string | null;
  entry_date: string;
  content: string;
  created_at?: string;
};

export type PlantPhoto = {
  id: string;
  plant_id: string;
  plant_name: string;
  image_url: string;
  note: string;
  captured_at: string;
  created_at: string;
};
