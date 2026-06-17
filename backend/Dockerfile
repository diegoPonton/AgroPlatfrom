FROM python:3.12-slim

WORKDIR /app

# --- Sistema ---
RUN apt-get update && apt-get install -y \
    libpq-dev gcc git curl \
    && rm -rf /var/lib/apt/lists/*

# --- Python deps (incluye esptool para merge_bin) ---
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- PlatformIO ---
RUN pip install --no-cache-dir platformio

# --- Firmware source (incluido en el repo) ---
COPY firmware/ /firmware/

# --- Pre-cachear todas las dependencias de PlatformIO ---
# Compila ambos targets una vez para que ~/.platformio/packages quede cacheado.
# Las compilaciones en runtime solo recompilan el código fuente (~30s).
RUN cd /firmware && pio run -e emisor  || true
RUN cd /firmware && pio run -e receptor || true

# --- Verificar esptool disponible (bundled con PlatformIO) ---
RUN find /root/.platformio/packages -name "esptool.py" 2>/dev/null | head -3 \
    && test -f $(find /root/.platformio/packages -name "esptool.py" 2>/dev/null | head -1) \
    && echo "esptool.py OK"

# --- App Django ---
COPY . .

ENV DJANGO_SETTINGS_MODULE=config.settings.production
ENV FIRMWARE_SOURCE_PATH=/firmware

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
CMD ["/entrypoint.sh"]
