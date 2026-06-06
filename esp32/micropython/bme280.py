import time


class BME280:
    ADDRESS = 0x76

    def __init__(self, i2c, address=ADDRESS):
        self.i2c = i2c
        self.address = address
        self._read_calibration()
        self._write(0xF2, 0x01)
        self._write(0xF4, 0x27)
        self._write(0xF5, 0xA0)
        self.t_fine = 0
        time.sleep_ms(100)

    def _read(self, register, length):
        return self.i2c.readfrom_mem(self.address, register, length)

    def _write(self, register, value):
        self.i2c.writeto_mem(self.address, register, bytes([value]))

    @staticmethod
    def _u16(data, index):
        return data[index] | (data[index + 1] << 8)

    @staticmethod
    def _s16(data, index):
        value = data[index] | (data[index + 1] << 8)
        return value - 65536 if value > 32767 else value

    def _read_calibration(self):
        c1 = self._read(0x88, 26)
        c2 = self._read(0xE1, 7)

        self.dig_T1 = self._u16(c1, 0)
        self.dig_T2 = self._s16(c1, 2)
        self.dig_T3 = self._s16(c1, 4)

        self.dig_P1 = self._u16(c1, 6)
        self.dig_P2 = self._s16(c1, 8)
        self.dig_P3 = self._s16(c1, 10)
        self.dig_P4 = self._s16(c1, 12)
        self.dig_P5 = self._s16(c1, 14)
        self.dig_P6 = self._s16(c1, 16)
        self.dig_P7 = self._s16(c1, 18)
        self.dig_P8 = self._s16(c1, 20)
        self.dig_P9 = self._s16(c1, 22)

        self.dig_H1 = c1[25]
        self.dig_H2 = self._s16(c2, 0)
        self.dig_H3 = c2[2]
        self.dig_H4 = (c2[3] << 4) | (c2[4] & 0x0F)
        if self.dig_H4 > 2047:
            self.dig_H4 -= 4096
        self.dig_H5 = (c2[5] << 4) | (c2[4] >> 4)
        if self.dig_H5 > 2047:
            self.dig_H5 -= 4096
        self.dig_H6 = c2[6] - 256 if c2[6] > 127 else c2[6]

    def read(self):
        data = self._read(0xF7, 8)
        adc_p = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
        adc_t = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)
        adc_h = (data[6] << 8) | data[7]

        var1 = (((adc_t >> 3) - (self.dig_T1 << 1)) * self.dig_T2) >> 11
        var2 = (((((adc_t >> 4) - self.dig_T1) * ((adc_t >> 4) - self.dig_T1)) >> 12) * self.dig_T3) >> 14
        self.t_fine = var1 + var2
        temperature = ((self.t_fine * 5 + 128) >> 8) / 100

        var1 = self.t_fine - 128000
        var2 = var1 * var1 * self.dig_P6
        var2 = var2 + ((var1 * self.dig_P5) << 17)
        var2 = var2 + (self.dig_P4 << 35)
        var1 = ((var1 * var1 * self.dig_P3) >> 8) + ((var1 * self.dig_P2) << 12)
        var1 = (((1 << 47) + var1) * self.dig_P1) >> 33
        if var1 == 0:
            pressure = 0
        else:
            p = 1048576 - adc_p
            p = (((p << 31) - var2) * 3125) // var1
            var1 = (self.dig_P9 * (p >> 13) * (p >> 13)) >> 25
            var2 = (self.dig_P8 * p) >> 19
            pressure = ((p + var1 + var2) >> 8) + (self.dig_P7 << 4)
            pressure = pressure / 25600

        h = self.t_fine - 76800
        h = (((((adc_h << 14) - (self.dig_H4 << 20) - (self.dig_H5 * h)) + 16384) >> 15) *
             (((((((h * self.dig_H6) >> 10) * (((h * self.dig_H3) >> 11) + 32768)) >> 10) +
                2097152) * self.dig_H2 + 8192) >> 14))
        h = h - (((((h >> 15) * (h >> 15)) >> 7) * self.dig_H1) >> 4)
        h = 0 if h < 0 else h
        h = 419430400 if h > 419430400 else h
        humidity = (h >> 12) / 1024

        return temperature, humidity, pressure
