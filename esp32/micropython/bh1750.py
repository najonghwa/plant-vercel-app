import time


class BH1750:
    ADDRESS = 0x23
    POWER_ON = 0x01
    CONTINUOUS_HIGH_RES_MODE = 0x10

    def __init__(self, i2c, address=ADDRESS):
        self.i2c = i2c
        self.address = address
        self.i2c.writeto(self.address, bytes([self.POWER_ON]))
        self.i2c.writeto(self.address, bytes([self.CONTINUOUS_HIGH_RES_MODE]))
        time.sleep_ms(180)

    def read_lux(self):
        data = self.i2c.readfrom(self.address, 2)
        raw = (data[0] << 8) | data[1]
        return raw / 1.2
