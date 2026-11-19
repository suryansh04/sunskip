"""Caps on the paid calls. Counted in memory: there is one api process (TRD §5.3),
so a restart only gives everyone a fresh day early.

A device is only its X-Client-Id, which anyone can make up, so each cap also counts by IP address.
Many students share one campus IP, so an IP gets several devices' worth (`cap_devices_per_ip`)."""

import time
from collections import Counter
from datetime import date, datetime

from app.config import IST, settings
from app.core.errors import ApiError

SECONDS_PER_MINUTE = 60


class DailyCap:
    def __init__(self, per_device: int, in_total: int) -> None:
        self.per_device = per_device
        self.per_ip = per_device * settings.cap_devices_per_ip
        self.in_total = in_total
        self.day: date | None = None
        self.by_device: Counter[str] = Counter()
        self.by_ip: Counter[str] = Counter()
        self.total = 0

    def take(self, client_hash: str | None, ip: str | None = None) -> None:
        """Counts one call, or raises 429 when this device, its IP or everyone has used today's share."""
        today = datetime.now(IST).date()
        if today != self.day:
            self.day, self.by_device, self.by_ip, self.total = today, Counter(), Counter(), 0
        device = client_hash or "unknown"
        address = ip or "unknown"
        if (
            self.total >= self.in_total
            or self.by_device[device] >= self.per_device
            or self.by_ip[address] >= self.per_ip
        ):
            raise ApiError(429, "RATE_LIMITED", "Daily limit reached. Try again tomorrow")
        self.by_device[device] += 1
        self.by_ip[address] += 1
        self.total += 1


class MinuteLimit:
    """At most `per_minute` requests from one key in each clock minute: a cheap brake on scripts."""

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self.minute = -1
        self.counts: Counter[str] = Counter()

    def allow(self, key: str) -> bool:
        minute = int(time.monotonic() // SECONDS_PER_MINUTE)
        if minute != self.minute:
            self.minute, self.counts = minute, Counter()
        self.counts[key] += 1
        return self.counts[key] <= self.per_minute
