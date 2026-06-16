#!/bin/sh
set -e
python manage.py migrate --no-input
python manage.py collectstatic --no-input --clear
exec daphne -b 0.0.0.0 -p "${PORT:-8000}" config.asgi:application
