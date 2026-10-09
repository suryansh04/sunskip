from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.core.geo import MAX_LAT, MAX_LNG

Mode = Literal["WALK", "BUS", "METRO", "RAIL", "ERICKSHAW"]
RouteWarning = Literal[
    "HEAT_ALERT",
    "FARE_ESTIMATED",
    "LONG_WAIT_IN_SUN",
    "SHADE_PREPARING",
    "NO_SHADE_DATA",
    "NO_SHADE_DATA_PARTIAL",
]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LatLng(ApiModel):
    lat: float = Field(ge=-MAX_LAT, le=MAX_LAT)
    lng: float = Field(ge=-MAX_LNG, le=MAX_LNG)


class PlaceInput(ApiModel):
    lat: float | None = Field(default=None, ge=-MAX_LAT, le=MAX_LAT)
    lng: float | None = Field(default=None, ge=-MAX_LNG, le=MAX_LNG)
    query: str | None = Field(default=None, min_length=2, max_length=200)

    @model_validator(mode="after")
    def needs_point_or_query(self) -> "PlaceInput":
        if self.query or (self.lat is not None and self.lng is not None):
            return self
        raise ValueError("send either lat and lng, or query")


class Place(ApiModel):
    name: str | None = None
    location: LatLng


class Shade(ApiModel):
    status: Literal["READY", "PREPARING", "UNAVAILABLE"]
    job_id: str | None = None
    cells_total: int | None = None
    cells_done: int | None = None
    poll_after_seconds: int | None = None


class Exposure(ApiModel):
    walk_meters: int
    walk_minutes: float
    sun_minutes: float | None = None
    sun_minutes_hot: float | None = None
    wait_sun_minutes: float | None = None
    shade_pct: float | None = None
    heat_dose: float | None = None
    feels_like_c: float | None = None


class TransitLine(ApiModel):
    short_name: str | None = None
    name: str | None = None
    vehicle: Mode
    headway_seconds: int | None = None


class Leg(ApiModel):
    mode: Mode
    from_: Place = Field(alias="from")
    to: Place
    start_at: datetime
    end_at: datetime
    distance_meters: int
    duration_seconds: int
    polyline: dict  # GeoJSON LineString
    shade_known: bool = False
    coverage: Literal["FULL", "PARTIAL", "NONE"] | None = None
    exposure: Exposure | None = None
    line: TransitLine | None = None
    wait_seconds: int | None = None
    stop_shaded: bool | None = None
    fare_inr: int | None = None
    swapped_from: Literal["WALK"] | None = None
    segment_ids: list[int] = Field(default_factory=list, exclude=True)  # stored in trips, never returned


class RouteOption(ApiModel):
    option_id: str
    labels: list[Literal["RECOMMENDED", "FASTEST", "CHEAPEST", "COOLEST"]] = Field(default_factory=list)
    depart_at: datetime
    arrive_at: datetime
    duration_seconds: int
    fare_inr: int | None = None
    exposure: Exposure
    legs: list[Leg]
    warnings: list[RouteWarning] = Field(default_factory=list)


class PlanRequest(ApiModel):
    origin: PlaceInput
    destination: PlaceInput
    depart_at: datetime | None = None
    preference: float = Field(default=0.5, ge=0, le=1)
    allow_erickshaw: bool = True


class TripConditions(ApiModel):
    feels_like_c: float | None = None
    heat_alert: bool = False
    typical: bool = False


class PlanResponse(ApiModel):
    trip_id: str
    shade: Shade
    conditions: TripConditions
    options: list[RouteOption]


class BestTimeRequest(ApiModel):
    origin: PlaceInput
    destination: PlaceInput
    date: date
    from_: str = Field(default="07:00", alias="from", pattern=r"^\d{2}:\d{2}$")
    to: str = Field(default="19:00", pattern=r"^\d{2}:\d{2}$")
    step_minutes: Literal[15, 30, 60] = 30


class Slot(ApiModel):
    depart_at: datetime
    sun_minutes: float | None = None
    heat_dose: float | None = None


class BestSlot(ApiModel):
    depart_at: datetime


class BestTimeResponse(ApiModel):
    basis: Literal["SHADE", "TEMPERATURE_ONLY"]
    shade: Shade
    slots: list[Slot]
    best: BestSlot | None = None
    note: str


class Waypoint(ApiModel):
    index: int
    location: LatLng
    distance_from_start_m: float
    leg_index: int
    bearing_deg: float
    in_sun: bool | None = None
    cue: str | None = None


class WaypointsResponse(ApiModel):
    spacing_m: float
    waypoints: list[Waypoint]


class ChoiceRequest(ApiModel):
    option_id: str


class ShadeJob(ApiModel):
    job_id: str
    status: Literal["QUEUED", "RUNNING", "DONE", "FAILED"]
    reason: Literal["PLAN", "MAP", "PORTAL", "PRELOAD"]
    cells_total: int
    cells_done: int
    cells_no_data: int
    poll_after_seconds: int
    ready_to_replan: bool


class HourlyConditions(ApiModel):
    at: datetime
    temp_c: float | None = None
    feels_like_c: float | None = None


class Conditions(ApiModel):
    at: datetime
    temp_c: float | None = None
    feels_like_c: float | None = None
    naqi: int | None = None
    naqi_category: str | None = None
    heat_alert: bool = False
    hourly: list[HourlyConditions] = Field(default_factory=list)
    source: dict = Field(default_factory=lambda: {"weather": "open-meteo", "air": "google-air-quality"})
    stale: bool = False
    typical: bool = False


MAX_SIMULATED_ITEMS = 50


class SimulatedItem(ApiModel):
    type: Literal["TREE", "SHELTER"]
    location: LatLng
    height_m: float = Field(gt=0, le=30)
    crown_radius_m: float | None = Field(default=None, gt=0, le=15)  # TREE
    width_m: float | None = Field(default=None, gt=0, le=20)  # SHELTER
    length_m: float | None = Field(default=None, gt=0, le=50)  # SHELTER
    bearing_deg: float = Field(default=0, ge=0, lt=360)  # SHELTER: direction of its length

    @model_validator(mode="after")
    def needs_size(self) -> "SimulatedItem":
        if self.type == "TREE" and self.crown_radius_m:
            return self
        if self.type == "SHELTER" and self.width_m and self.length_m:
            return self
        raise ValueError("a TREE needs crownRadiusM; a SHELTER needs widthM and lengthM")


class SimulateRequest(ApiModel):
    month: int = Field(default=5, ge=1, le=12)
    hours: tuple[int, int] = (10, 16)
    items: list[SimulatedItem] = Field(min_length=1, max_length=MAX_SIMULATED_ITEMS)

    @model_validator(mode="after")
    def valid_hours(self) -> "SimulateRequest":
        if 0 <= self.hours[0] <= self.hours[1] <= 23:
            return self
        raise ValueError("hours must be [from, to] with 0 <= from <= to <= 23")
