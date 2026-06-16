import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class DeviceTelemetryConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Validate JWT from ?token= query param
        query_string = self.scope.get('query_string', b'').decode()
        params = {}
        for part in query_string.split('&'):
            if '=' in part:
                k, v = part.split('=', 1)
                params[k] = v

        token = params.get('token', '')
        if not token or not await self._authenticate(token):
            await self.close(code=4001)
            return

        self.device_id = self.scope['url_route']['kwargs']['device_id']
        self.group_name = f'device_{self.device_id}'.replace(':', '_').replace('.', '_')
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def telemetry_message(self, event):
        await self.send(text_data=json.dumps(event['data']))

    @database_sync_to_async
    def _authenticate(self, token: str) -> bool:
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from django.contrib.auth import get_user_model
            validated = AccessToken(token)
            User = get_user_model()
            User.objects.get(pk=validated['user_id'], is_active=True)
            return True
        except Exception:
            return False
