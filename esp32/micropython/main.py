import time
import network
import ujson
import urequests
from machine import ADC, I2C, Pin

from secrets import WIFI_SSID, WIFI_PASSWORD, DEVICE_API_TOKEN
from bme280 import BME280
from bh1750 import BH1750


SENSOR_POST_URL = "https://plant-vercel-app.vercel.app/api/sensor-readings"
PUMP_COMMAND_URL = "https://plant-vercel-app.vercel.app/api/pump-commands?device_id=pump-balcony-01"
PUMP_PATCH_URL = "https://plant-vercel-app.vercel.app/api/pump-commands"

LOCATION = "\uBCA0\uB780\uB2E4"
SENSOR_DEVICE_ID = "esp32-balcony-01"

I2C_SDA_PIN = 21
I2C_SCL_PIN = 22
MOISTURE_PIN = 34
RELAY_PIN = 26

DRY_VALUE = 3000
WET_VALUE = 1200
RELAY_ACTIVE_HIGH = True

POST_INTERVAL_SECONDS = 60
PUMP_POLL_INTERVAL_SECONDS = 15


def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("WiFi connecting...")
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        while not wlan.isconnected():
            time.sleep(0.5)
            print(".", end="")
    print("")
    print("WiFi connected:", wlan.ifconfig())


def map_moisture(raw):
    percent = (raw - DRY_VALUE) * 100 / (WET_VALUE - DRY_VALUE)
    if percent < 0:
        return 0
    if percent > 100:
        return 100
    return round(percent)


def relay_write(relay, on):
    if RELAY_ACTIVE_HIGH:
        relay.value(1 if on else 0)
    else:
        relay.value(0 if on else 1)


def post_sensor_reading(payload):
    headers = {
        "Content-Type": "application/json",
        "x-device-token": DEVICE_API_TOKEN,
    }
    response = None
    try:
        response = urequests.post(SENSOR_POST_URL, data=ujson.dumps(payload), headers=headers)
        print("Sensor POST:", response.status_code, response.text)
    except Exception as exc:
        print("Sensor POST failed:", exc)
    finally:
        if response:
            response.close()


def patch_pump_command(command_id, status):
    headers = {
        "Content-Type": "application/json",
        "x-device-token": DEVICE_API_TOKEN,
    }
    response = None
    try:
        body = ujson.dumps({"command_id": command_id, "status": status})
        response = urequests.request("PATCH", PUMP_PATCH_URL, data=body, headers=headers)
        print("Pump PATCH:", status, response.status_code, response.text)
    except Exception as exc:
        print("Pump PATCH failed:", exc)
    finally:
        if response:
            response.close()


def poll_pump_commands(relay):
    headers = {"x-device-token": DEVICE_API_TOKEN}
    response = None
    try:
        response = urequests.get(PUMP_COMMAND_URL, headers=headers)
        print("Pump GET:", response.status_code)
        data = response.json()
        commands = data.get("commands", [])
    except Exception as exc:
        print("Pump GET failed:", exc)
        commands = []
    finally:
        if response:
            response.close()

    for command in commands:
        command_id = command.get("id")
        seconds = int(command.get("watering_seconds", 5))
        if not command_id:
            continue

        print("Pump running:", command_id, seconds, "seconds")
        patch_pump_command(command_id, "running")
        relay_write(relay, True)
        time.sleep(seconds)
        relay_write(relay, False)
        patch_pump_command(command_id, "completed")


def main():
    connect_wifi()

    i2c = I2C(0, scl=Pin(I2C_SCL_PIN), sda=Pin(I2C_SDA_PIN), freq=100000)
    bme = BME280(i2c)
    light = BH1750(i2c)

    moisture_adc = ADC(Pin(MOISTURE_PIN))
    moisture_adc.atten(ADC.ATTN_11DB)
    moisture_adc.width(ADC.WIDTH_12BIT)

    relay = Pin(RELAY_PIN, Pin.OUT)
    relay_write(relay, False)

    last_post = 0
    last_pump_poll = 0

    while True:
        now = time.time()

        temperature, humidity, pressure = bme.read()
        lux = light.read_lux()
        moisture_raw = moisture_adc.read()
        moisture_percent = map_moisture(moisture_raw)

        print(
            "lux:", round(lux, 1),
            "moisture:", moisture_percent,
            "raw:", moisture_raw,
            "temp:", round(temperature, 1),
            "humidity:", round(humidity, 1),
            "pressure:", round(pressure, 1),
        )

        if now - last_post >= POST_INTERVAL_SECONDS:
            payload = {
                "location": LOCATION,
                "device_id": SENSOR_DEVICE_ID,
                "temperature_c": round(temperature, 1),
                "humidity_pct": round(humidity, 1),
                "light_lux": round(lux),
                "soil_moisture_pct": moisture_percent,
            }
            post_sensor_reading(payload)
            last_post = now

        if now - last_pump_poll >= PUMP_POLL_INTERVAL_SECONDS:
            poll_pump_commands(relay)
            last_pump_poll = now

        time.sleep(2)


main()
