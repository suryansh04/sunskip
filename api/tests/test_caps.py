import pytest

from app.config import settings
from app.core.caps import DailyCap, MinuteLimit
from app.core.errors import ApiError


def test_daily_cap_per_device() -> None:
    cap = DailyCap(per_device=2, in_total=100)
    cap.take("a", "1.1.1.1")
    cap.take("a", "1.1.1.1")
    with pytest.raises(ApiError) as caught:
        cap.take("a", "1.1.1.1")
    assert caught.value.status == 429
    cap.take("b", "1.1.1.1")  # another device on the same IP still has its share


def test_daily_cap_counts_by_ip_so_new_ids_dont_help() -> None:
    cap = DailyCap(per_device=1, in_total=1000)
    for n in range(settings.cap_devices_per_ip):
        cap.take(f"made-up-{n}", "6.6.6.6")
    with pytest.raises(ApiError):
        cap.take("made-up-again", "6.6.6.6")
    cap.take("someone-else", "7.7.7.7")


def test_daily_cap_total() -> None:
    cap = DailyCap(per_device=10, in_total=2)
    cap.take("a", "1")
    cap.take("b", "2")
    with pytest.raises(ApiError):
        cap.take("c", "3")


def test_minute_limit() -> None:
    limit = MinuteLimit(per_minute=3)
    assert [limit.allow("ip") for _ in range(4)] == [True, True, True, False]
    assert limit.allow("other-ip")
