# Plant Vercel App

식물 급수 기록, 식물 추가, ESP32 센서값 수신을 Vercel + Postgres 기준으로 구성한 Next.js 앱입니다.

## 구조

- `app/page.tsx`: 대시보드 화면
- `app/api/plants`: 식물 목록 조회/추가
- `app/api/watering-logs`: 급수 기록 조회/추가
- `app/api/plant-photos`: 식물 사진 목록(썸네일)/업로드, `[id]`는 원본 조회/삭제
- `app/api/sensor-readings`: ESP32 센서값 조회/수신
- `app/api/pump-commands`: 자동급수 펌프 명령 조회/완료 처리
- `app/api/bootstrap`: DB 테이블 생성 및 초기 데이터 삽입
- `lib/migrations.ts`: 기존 DB 스키마를 배포만으로 맞추는 자동 마이그레이션
- `db/schema.sql`: Postgres 스키마
- `esp32/balcony_sensor_post.ino`: 베란다 센서 전송 예시
- `esp32/pump_controller_poll.ino`: 펌프 릴레이 컨트롤러 예시

## 앱 기능 메모

- 급수 기록은 한 날짜에 여러 식물을 한 번에 저장할 수 있습니다.
- 급수 캘린더는 월간 달력으로 표시되며, 날짜를 누르면 그날의 급수 기록을 보고 추가/삭제할 수 있습니다.
- 사진은 별도 스토리지 없이 data URL로 Postgres에 저장합니다. 브라우저에서 원본(최대 1280px)과 썸네일(360px)을 만들어 보내고, 목록 API는 썸네일만 내려줍니다. 원본은 `/api/plant-photos/[id]`로 따로 가져옵니다. 식물당 200장, 전체 2000장 상한이 있습니다.
- 물주기 추천은 최근 급수 간격(중앙값), 계절, 구역별 온도/습도/조도, 토양수분 실측, 식물별 물 요구도를 반영하는 규칙 기반 계산입니다.
  - 최근 6구간의 **중앙값**을 쓰고, 간격이 2구간 미만이면 기본 주기를 씁니다. 학습값도 기본 주기의 0.5~2배로 제한합니다.
  - 마지막 수신이 **6시간**을 넘은 센서값은 "지금 환경"으로 보지 않고 계산에서 제외하며, 화면에 수신 끊김으로 표시합니다.
  - 미래 날짜로 적힌 급수 기록은 계산에서 제외합니다.

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

`soil_moisture_pct`는 **선택값**입니다. 토양센서를 달지 않았으면 항목을 빼고 보내면 되고, 그래도 온도·습도·조도는 정상 저장됩니다. 값을 생략하면 DB에 `null`(측정 안 함)로 들어가며, `0`(완전히 마름)과 구분됩니다. 자동급수는 토양수분 실측이 있을 때만 동작합니다.

## 자동급수 흐름

자동급수는 식물별로 켜고 끄는 구조입니다. 모든 식물이 자동급수 대상이 되는 것이 아니라, 대시보드에서 자동급수 대상으로 지정한 식물만 펌프 명령 생성 대상이 됩니다.

1. 베란다 ESP32가 `/api/sensor-readings`로 온도, 습도, 조도, 토양수분을 보냅니다.
2. 서버는 같은 구역의 자동급수 대상 식물을 확인합니다.
3. 토양수분이 해당 식물의 `moisture_min_pct`보다 낮고, 쿨다운/일일 횟수 제한을 통과하면 `pump_commands`에 대기 명령을 만듭니다. 기기당 처리 중인 명령은 1건으로 제한됩니다(DB 유니크 인덱스).
4. 펌프 ESP32가 `/api/pump-commands?device_id=pump-balcony-01`을 주기적으로 조회합니다.
5. 펌프가 명령을 실행한 뒤 `PATCH /api/pump-commands`로 `completed`를 보내면 자동 급수 로그가 저장됩니다.

기기가 명령을 받아간 뒤 10분 안에 결과를 보고하지 않으면 `failed`로 회수합니다. 회수하지 않으면 미완료 명령이 남아 그 기기의 자동급수가 영구히 멈춥니다.

`watering_seconds` 상한은 펌웨어의 실제 한계에 맞춘 **15초**이며, UI·API·DB 제약이 모두 같은 값입니다. 펌프는 실제 물 넘침 위험이 있으니 처음에는 3-5초로 짧게 두고, `cooldown_hours`와 `max_runs_per_day`를 보수적으로 잡는 것을 권장합니다.

### 인증

- 기기용 라우트(`POST /api/sensor-readings`, `GET/PATCH /api/pump-commands`, `POST /api/pump-test`, `POST /api/rucola-auto-setup`)는 `DEVICE_API_TOKEN`을 요구합니다.
- 대시보드가 브라우저에서 직접 호출하는 라우트에는 **사용자 인증이 없습니다.** 주소를 아는 사람은 누구나 기록을 바꿀 수 있고, `POST /api/pump-commands`는 실제로 물이 나갑니다(하루 5회 상한으로만 제한). 공개 주소로 운영한다면 Vercel의 Password Protection이나 별도 로그인을 붙이는 것을 권장합니다.

## 배포 흐름

1. `plant-vercel-app` 폴더를 GitHub 저장소로 올립니다.
2. Vercel에서 해당 저장소를 Import 합니다.
3. Postgres DB를 연결하고 `POSTGRES_URL`, `DEVICE_API_TOKEN`을 설정합니다.
4. 배포 후 `/api/bootstrap`을 POST로 한 번 호출합니다. 이미 운영 중인 DB라면 앱이 뜰 때 필요한 스키마 변경(사진 썸네일 컬럼, 토양수분 nullable, 급수 15초 제약, 펌프 명령 유니크 인덱스)을 자동으로 적용하므로 수동 SQL은 필요 없습니다.
5. 센서 ESP32 코드의 `serverUrl`, `deviceToken`, Wi-Fi 정보를 실제 값으로 변경해 업로드합니다.
6. 펌프를 붙일 때 `pump_controller_poll.ino`의 릴레이 핀, `commandUrl`, `deviceToken`을 실제 값으로 변경해 업로드합니다.
