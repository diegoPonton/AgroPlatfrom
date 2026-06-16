from django.contrib import admin
from .models import FirmwareBuild, FlashLog

admin.site.register(FirmwareBuild)
admin.site.register(FlashLog)
