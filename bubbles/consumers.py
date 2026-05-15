from __future__ import annotations

import uuid
from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import Bubble, Message
from .services import (
    bubble_channel_group,
    haversine_distance_m,
    online_count_decr,
    online_count_incr,
    throttle_allow,
)


def _parse_float(qs: dict, key: str) -> float | None:
    vals = qs.get(key)
    if not vals:
        return None
    try:
        return float(vals[0])
    except (TypeError, ValueError):
        return None


class BubbleConsumer(AsyncJsonWebsocketConsumer):
    """
    Realtime channel for a bubble: chat, typing, presence, online counts.
    Requires prior `GET /api/me/` so `bbl_anon` cookie exists.
    Connect URL: /ws/bubble/<uuid>/?lat=..&lng=..
    """

    async def connect(self):
        self.bubble_id: uuid.UUID | None = None
        self.group_name: str | None = None
        self.user_name = self.scope.get("bubblle_anonymous_name")
        if not self.user_name:
            await self.close(code=4401)
            return

        raw_id = self.scope["url_route"]["kwargs"].get("bubble_id")
        try:
            self.bubble_id = uuid.UUID(str(raw_id))
        except (ValueError, TypeError):
            await self.close(code=4400)
            return

        qs_raw = self.scope.get("query_string", b"").decode()
        qs = parse_qs(qs_raw)
        lat = _parse_float(qs, "lat")
        lng = _parse_float(qs, "lng")
        if lat is None or lng is None:
            await self.close(code=4400)
            return

        bubble = await self._get_bubble(self.bubble_id)
        if not bubble or not bubble.is_joinable():
            await self.close(code=4404)
            return

        dist = haversine_distance_m(lat, lng, bubble.latitude, bubble.longitude)
        if dist > bubble.radius:
            await self.close(code=4403)
            return

        self.group_name = bubble_channel_group(self.bubble_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        online = await sync_to_async(online_count_incr)(self.bubble_id)
        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "bubble.presence",
                "event": "user_joined",
                "name": self.user_name,
                "online": online,
            },
        )

    async def disconnect(self, code):
        if self.group_name and self.bubble_id:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            online = await sync_to_async(online_count_decr)(self.bubble_id)
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "bubble.presence",
                    "event": "user_left",
                    "name": self.user_name,
                    "online": online,
                },
            )

    async def receive_json(self, content):
        if not self.group_name or not self.bubble_id:
            return

        msg_type = content.get("type")
        if msg_type == "typing":
            lat = content.get("latitude")
            lng = content.get("longitude")
            if lat is None or lng is None:
                return
            ok = await self._within_bubble(float(lat), float(lng))
            if not ok:
                return
            key = f"bbl:typing:{self.bubble_id}:{self.user_name}"
            if not await sync_to_async(throttle_allow)(key, 3):
                return
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "bubble.typing",
                    "name": self.user_name,
                    "typing": bool(content.get("typing", True)),
                },
            )
            return

        if msg_type != "chat":
            return

        text = (content.get("message") or "").strip()
        if not text or len(text) > 2000:
            return

        lat = content.get("latitude")
        lng = content.get("longitude")
        if lat is None or lng is None:
            return
        ok = await self._within_bubble(float(lat), float(lng))
        if not ok:
            await self.send_json({"type": "error", "code": "out_of_radius"})
            return

        session_uuid = self.scope.get("bubblle_session_uuid") or "anon"
        throttle_key = f"bbl:msgthrottle:{self.bubble_id}:{session_uuid}"
        if not await sync_to_async(throttle_allow)(throttle_key, 2):
            await self.send_json({"type": "error", "code": "slow_down"})
            return

        bubble = await self._get_bubble(self.bubble_id)
        if not bubble or not bubble.is_joinable():
            await self.send_json({"type": "error", "code": "bubble_closed"})
            return

        msg = await self._persist_message(bubble, self.user_name, text)
        payload = {
            "type": "bubble.chat",
            "message": {
                "id": str(msg.id),
                "anonymous_name": msg.anonymous_name,
                "message": msg.message,
                "created_at": msg.created_at.isoformat(),
            },
        }
        await self.channel_layer.group_send(self.group_name, payload)

    # --- group handlers ---

    async def bubble_chat(self, event):
        await self.send_json({"type": "chat", "payload": event["message"]})

    async def bubble_presence(self, event):
        await self.send_json(
            {
                "type": "presence",
                "event": event["event"],
                "name": event["name"],
                "online": event["online"],
            }
        )

    async def bubble_typing(self, event):
        await self.send_json(
            {
                "type": "typing",
                "name": event["name"],
                "typing": event["typing"],
            }
        )

    # --- helpers ---

    @database_sync_to_async
    def _get_bubble(self, bubble_id: uuid.UUID) -> Bubble | None:
        try:
            b = Bubble.objects.get(id=bubble_id)
        except Bubble.DoesNotExist:
            return None
        if b.is_expired() and b.active:
            b.active = False
            b.save(update_fields=["active"])
        return b

    @database_sync_to_async
    def _within_bubble(self, lat: float, lng: float) -> bool:
        try:
            b = Bubble.objects.get(id=self.bubble_id)
        except Bubble.DoesNotExist:
            return False
        if not b.is_joinable():
            return False
        return haversine_distance_m(lat, lng, b.latitude, b.longitude) <= b.radius

    @database_sync_to_async
    def _persist_message(self, bubble: Bubble, anonymous_name: str, text: str) -> Message:
        return Message.objects.create(bubble=bubble, anonymous_name=anonymous_name, message=text)
