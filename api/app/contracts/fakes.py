"""Fixed answers for USE_FAKES=true: the real MUJ -> Bus 26 pilot numbers (810 m, 11.3 min at 1 PM, 7.4 at 5 PM)."""

import uuid

PILOT_START = {"lat": 26.84406, "lng": 75.56516}
BUS_26_STOP = {"lat": 26.83894, "lng": 75.56537}
PILOT_LINE = {"type": "LineString", "coordinates": [[75.56516, 26.84406], [75.56537, 26.83894]]}


def fake_conditions() -> dict:
    return {
        "at": "2026-05-15T13:00:00+05:30",
        "tempC": 41.0,
        "feelsLikeC": 44.0,
        "naqi": 112,
        "naqiCategory": "Moderate",
        "heatAlert": True,
        "hourly": [{"at": "2026-05-15T13:00:00+05:30", "tempC": 41.0, "feelsLikeC": 44.0}],
        "source": {"weather": "open-meteo", "air": "google-air-quality"},
        "stale": False,
        "typical": True,
    }


def fake_walk_leg(walk_exposure: dict) -> dict:
    return {
        "mode": "WALK",
        "from": {"name": None, "location": PILOT_START},
        "to": {"name": "Bus 26 stop", "location": BUS_26_STOP},
        "startAt": "2026-05-15T13:00:00+05:30",
        "endAt": "2026-05-15T13:11:15+05:30",
        "distanceMeters": 810,
        "durationSeconds": 675,
        "polyline": PILOT_LINE,
        "shadeKnown": True,
        "coverage": "FULL",
        "exposure": walk_exposure,
    }


def fake_plan() -> dict:
    walk_exposure = {
        "walkMeters": 810,
        "walkMinutes": 11.3,
        "sunMinutes": 11.3,
        "sunMinutesHot": 11.3,
        "waitSunMinutes": None,
        "shadePct": 0,
        "heatDose": 20.3,
        "feelsLikeC": 44.0,
    }
    return {
        "tripId": str(uuid.uuid4()),
        "shade": {"status": "READY", "jobId": None},
        "conditions": {"feelsLikeC": 44.0, "heatAlert": True, "typical": True},
        "options": [
            {
                "optionId": "opt_1",
                "labels": ["RECOMMENDED", "FASTEST", "CHEAPEST", "COOLEST"],
                "departAt": "2026-05-15T13:00:00+05:30",
                "arriveAt": "2026-05-15T13:11:15+05:30",
                "durationSeconds": 675,
                "fareInr": 0,
                "exposure": {**walk_exposure, "waitSunMinutes": 0.0},
                "legs": [fake_walk_leg(walk_exposure)],
                "warnings": ["HEAT_ALERT"],
            }
        ],
    }


def fake_best_time() -> dict:
    return {
        "basis": "SHADE",
        "shade": {"status": "READY", "jobId": None},
        "slots": [
            {"departAt": "2026-05-15T13:00:00+05:30", "sunMinutes": 11.3, "heatDose": 29.3},
            {"departAt": "2026-05-15T17:00:00+05:30", "sunMinutes": 7.4, "heatDose": 14.9},
        ],
        "best": {"departAt": "2026-05-15T17:00:00+05:30"},
        "note": "Bus times are not re-checked per slot.",
    }
