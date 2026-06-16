import json
from channels.generic.websocket import AsyncWebsocketConsumer


class DeviceTelemetryConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.device_id = self.scope['url_route']['kwargs']['device_id']
        self.group_name = f'device_{self.device_id}'.replace(':', '_').replace('.', '_')

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def telemetry_message(self, event):
        await self.send(text_data=json.dumps(event['data']))
