from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, Organization, Membership


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ('email', 'name', 'is_staff')
    ordering = ('email',)
    fieldsets = UserAdmin.fieldsets + (
        ('Extra', {'fields': ('name',)}),
    )


admin.site.register(Organization)
admin.site.register(Membership)
