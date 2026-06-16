from .base import *
from decouple import config
import dj_database_url

DEBUG = False

# Railway / producción — por defecto acepta cualquier host; restringir después
_allowed = config('ALLOWED_HOSTS', default='*')
ALLOWED_HOSTS = ['*'] if _allowed == '*' else [h.strip() for h in _allowed.split(',') if h.strip()]

# CORS: permite el frontend Railway y cualquier PR preview
CORS_ALLOW_CREDENTIALS = True
_cors = config('CORS_ALLOWED_ORIGINS', default='')
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors.split(',') if o.strip()]
CORS_ALLOWED_ORIGIN_REGEXES = [r'^https://.*\.up\.railway\.app$']

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ─── Base de datos ──────────────────────────────────────────────────────────
# Railway inyecta DATABASE_URL automáticamente al conectar el plugin PostgreSQL
_db_url = config('DATABASE_URL', default=None)
if _db_url:
    DATABASES = {
        'default': dj_database_url.parse(_db_url, conn_max_age=600, ssl_require=True)
    }

# ─── Redis / Channels ───────────────────────────────────────────────────────
# Railway inyecta REDIS_URL al conectar el plugin Redis
_redis_url = config('REDIS_URL', default=None)
if _redis_url:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [_redis_url]},
        },
    }

# ─── Archivos estáticos con WhiteNoise ──────────────────────────────────────
# Debe ir justo después de SecurityMiddleware (índice 1)
MIDDLEWARE.insert(1, 'whitenoise.middleware.WhiteNoiseMiddleware')
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
