from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.users.urls')),
    path('api/', include('apps.devices.urls')),
    path('api/', include('apps.telemetry.urls')),
    path('api/', include('apps.firmware.urls')),
    path('api/', include('apps.alerts.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
