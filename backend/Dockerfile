FROM python:3.12-slim

WORKDIR /app

# --- Sistema ---
RUN apt-get update && apt-get install -y \
    libpq-dev gcc git curl \
    && rm -rf /var/lib/apt/lists/*

# --- Python deps ---
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- PlatformIO ---
RUN pip install --no-cache-dir platformio

# --- Firmware source (incluido en el repo) ---
COPY firmware/ /firmware/

# --- Pre-cachear todas las dependencias de PlatformIO ---
# Compila ambos targets una vez durante el build del imagen para que
# ~/.platformio/packages quede cacheado. Las compilaciones en runtime
# solo necesitan recompilar el código fuente (~30s), sin descargar nada.
RUN cd /firmware && pio run -e emisor  || true
RUN cd /firmware && pio run -e receptor || true

# --- App Django ---
COPY . .

ENV DJANGO_SETTINGS_MODULE=config.settings.production
ENV FIRMWARE_SOURCE_PATH=/firmware

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
CMD ["/entrypoint.sh"]
