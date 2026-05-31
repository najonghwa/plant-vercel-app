# Plant Vercel App

식물 급수 기록, 식물 추가, ESP32 센서값 수신을 Vercel + Postgres 기준으로 구성한 Next.js 앱입니다.

## 구조

- `app/page.tsx`: 대시보드 화면
- `app/api/plants`: 식물 목록 조회/추가
- `app/api/watering-logs`: 급수 기록 조회/추가
- `app/api/sensor-readings`: ESP32 센서값 조회/수신
- `app/api/pump-commands`: 자동급수 펌프 명령 조회/완료 처리
- `app/api/bootstrap`: DB 테이블 생성 및 초기 데이터 삽입
- `db/schema.sql`: Postgres 스키마
- `esp32/balcony_sensor_post.ino`: 베란다 센서 전송 예시
- `esp32/pump_controller_poll.ino`: 펌프 릴레이 컨트롤러 예시

## DB 선택

Vercel에 배포할 때는 Vercel Marketplace의 Postgres 계열 DB를 붙이면 됩니다. Neon 또는 Supabase Postgres를 연결한 뒤 Vercel 환경변수에 `POSTGRES_URL`을 넣으세요.

## 환경변수

`.env.example`을 참고해 Vercel Project Settings > Environment Variables에 추가합니다.

```env
POSTGRES_URL="postgres://user:password@host:5432/database?sslmode=require"
DEVICE_API_TOKEN="길고-랜덤한-토큰"
```

## 초기화

배포 후 한 번만 아래 API를 호출하면 테이블과 초기 데이터가 생성됩니다.

```bash
curl -X POST https://YOUR_VERCEL_DOMAIN/api/bootstrap
```

로컬 개발에서는:

```bash
npm install
npm run dev
curl -X POST http://localhost:3000/api/bootstrap
```

## ESP32 센서 POST 형식

처음은 베란다만 적용하는 전제로 만들었습니다. 거실 센서를 붙일 때는 `location`만 `"거실"`로 바꾸면 됩니다.

```http
POST /api/sensor-readings
x-device-token: DEVICE_API_TOKEN
content-type: application/json

{
  "location": "베란다",
  "device_id": "esp32-balcony-01",
  "temperature_c": 23.4,
  "humidity_pct": 61.2,
  "light_lux": 830,
  "soil_moisture_pct": 36.0
}
```

## 자동급수 흐름

자동급수는 식물별로 켜고 끄는 구조입니다. 모든 식물이 자동급수 대상이 되는 것이 아니라, 대시보드에서 자동급수 대상으로 지정한 식물만 펌프 명령 생성 대상이 됩니다.

1. 베란다 ESP32가 `/api/sensor-readings`로 온도, 습도, 조도, 토양수분을 보냅니다.
2. 서버는 같은 구역의 자동급수 대상 식물을 확인합니다.
3. 토양수분이 해당 식물의 `moisture_min_pct`보다 낮고, 쿨다운/일일 횟수 제한을 통과하면 `pump_commands`에 대기 명령을 만듭니다.
4. 펌프 ESP32가 `/api/pump-commands?device_id=pump-balcony-01`을 주기적으로 조회합니다.
5. 펌프가 명령을 실행한 뒤 `PATCH /api/pump-commands`로 `completed`를 보내면 자동 급수 로그가 저장됩니다.

펌프는 실제 물 넘침 위험이 있으니 처음에는 `watering_seconds`를 3-5초로 짧게 두고, `cooldown_hours`와 `max_runs_per_day`를 보수적으로 잡는 것을 권장합니다.

## 배포 흐름

1. `plant-vercel-app` 폴더를 GitHub 저장소로 올립니다.
2. Vercel에서 해당 저장소를 Import 합니다.
3. Postgres DB를 연결하고 `POSTGRES_URL`, `DEVICE_API_TOKEN`을 설정합니다.
4. 배포 후 `/api/bootstrap`을 POST로 한 번 호출합니다.
5. 센서 ESP32 코드의 `serverUrl`, `deviceToken`, Wi-Fi 정보를 실제 값으로 변경해 업로드합니다.
6. 펌프를 붙일 때 `pump_controller_poll.ino`의 릴레이 핀, `commandUrl`, `deviceToken`을 실제 값으로 변경해 업로드합니다.
