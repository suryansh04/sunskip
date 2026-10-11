"""Daily caps on the paid AI and voice calls. Counted in memory: there is one api process (TRD §5.3),
so a restart only gives everyone a fresh day early."""

from collections import Counter
from datetime import date, datetime

from app.config import IST
from app.core.errors import ApiError


class DailyCap:
    def __init__(self, per_device: int, in_total: int) -> None:
        self.per_device = per_device
        self.in_total = in_total
        self.day: date | None = None
        self.by_device: Counter[str] = Counter()
        self.total = 0

    def take(self, client_hash: str | None) -> None:
        """Counts one call, or raises 429 when this device or everyone has used today's share."""
        today = datetime.now(IST).date()
        if today != self.day:
            self.day, self.by_device, self.total = today, Counter(), 0
        device = client_hash or "unknown"
        if self.total >= self.in_total or self.by_device[device] >= self.per_device:
            raise ApiError(429, "RATE_LIMITED", "Daily limit reached. Try again tomorrow")
        self.by_device[device] += 1
        self.total += 1
