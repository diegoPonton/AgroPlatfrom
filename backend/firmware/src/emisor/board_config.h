#pragma once
// GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform — no editar a mano

// --- I2C (SHTC3) ---
#define I2C_SDA_PIN    21
#define I2C_SCL_PIN    22

// --- DS18B20 OneWire ---
#define DS18B20_PIN        4
#define DS18B20_RESOLUTION 12

// --- GPS UART ---
#define GPS_RX_PIN          16
#define GPS_TX_PIN          17
#define GPS_BAUD            9600
#define GPS_TIMEOUT_COLD_S  60
#define GPS_TIMEOUT_WARM_S  30
#define GPS_MIN_SATS        3

// --- Batería ADC ---
#define BAT_ADC_PIN    34
#define BAT_VREF       3.3f
#define BAT_ADC_MAX    4095
#define BAT_DIV_RATIO  2.0f
#define BAT_SAMPLES    50
#define BAT_V_MAX      4.20f
#define BAT_V_MIN      3.20f

// --- Sensores habilitados por defecto ---
#define SENSOR_SHTC3_DEFAULT    true
#define SENSOR_DS18B20_DEFAULT  true
#define SENSOR_GPS_DEFAULT      true

// --- Comportamiento ---
#define DEFAULT_SLEEP_MIN  10

// --- ESP-NOW ---
#define ESPNOW_CHANNEL     6
#define CMD_WINDOW_MS      12000
