import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getPool, query, queryOne } from "@/lib/db";
import { seedPlants, seedWateringLogs } from "@/lib/seed";

export async function POST() {
  const schema = await readFile(join(process.cwd(), "db", "schema.sql"), "utf8");
  await getPool().query(schema);

  const plantCount = await queryOne<{ count: string }>("select count(*)::text as count from plants");

  if (plantCount?.count === "0") {
    for (const plant of seedPlants) {
      await query(
        `insert into plants (name, category, location, water_level, sunlight, memo)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (name) do nothing`,
        plant,
      );
    }

    for (const [wateredAt, plantName] of seedWateringLogs) {
      await query(
        `insert into watering_logs (plant_id, plant_name, watered_at, memo, source)
         select id, name, $1::date, '', 'import'
         from plants
         where name = $2`,
        [wateredAt, plantName],
      );
    }

    await query(
      `insert into sensor_readings (location, device_id, temperature_c, humidity_pct, light_lux, soil_moisture_pct, recorded_at)
       values
       ('베란다', 'esp32-balcony-01', 21.0, 68.0, 950, 36.0, now()),
       ('거실', 'esp32-living-01', 24.2, 55.0, 420, 42.0, now())`,
    );
  }

  const counts = {
    plants: await queryOne<{ count: string }>("select count(*)::text as count from plants"),
    wateringLogs: await queryOne<{ count: string }>("select count(*)::text as count from watering_logs"),
    sensorReadings: await queryOne<{ count: string }>("select count(*)::text as count from sensor_readings"),
  };

  return NextResponse.json({ ok: true, counts });
}
