import json
from zoneinfo import ZoneInfo

import boto3
from pydantic_settings import BaseSettings, SettingsConfigDict

IST = ZoneInfo("Asia/Kolkata")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Secrets (Secrets Manager in production, .env locally)
    google_api_key: str = ""
    anthropic_api_key: str = ""
    sarvam_api_key: str = ""
    database_url: str = "postgresql://sunskip:sunskip@localhost:5433/sunskip"
    origin_secret: str = ""
    client_id_salt: str = "local-dev-salt"

    # Deploy
    secret_id: str = ""
    aws_region: str = "ap-south-1"
    s3_bucket: str = ""
    origin_secret_check: bool = True
    use_fakes: bool = False
    api_pool_size: int = 10
    worker_pool_size: int = 3
    outside_call_timeout_s: float = 10

    # Walking and heat (api.md §11)
    walk_speed_mps: float = 1.2
    heat_alert_feels_like_c: float = 40
    shade_alpha: float = 3.0
    max_detour_ratio: float = 1.3
    default_wait_seconds: int = 300
    long_wait_in_sun_min: float = 5
    walk_only_max_m: float = 3000
    max_options: int = 6
    swap_min_walk_m: float = 500
    swap_min_hot_sun_min: float = 5
    erickshaw_speed_mps: float = 4.2
    erickshaw_wait_seconds: int = 120
    waypoint_spacing_m: float = 25

    # Shade data (api.md §11, schema.md §8)
    corridor_buffer_m: float = 100
    max_cells_per_job: int = 120
    max_new_cells_per_client_per_day: int = 60
    max_shade_map_km2: float = 1
    solar_monthly_call_budget: int = 6500
    worker_solar_concurrency: int = 4
    overpass_urls: list[str] = [
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]
    representative_day: int = 15
    min_sun_elevation_deg: float = 5
    max_segment_m: float = 50
    shade_sample_spacing_m: float = 5
    stop_match_m: float = 30
    graph_snap_max_m: float = 60
    privacy_grid_deg: float = 0.0005
    poll_after_seconds: int = 3

    # Worker and api background loops
    stuck_after_minutes: int = 10
    heartbeat_interval_s: float = 30
    worker_idle_sleep_s: float = 2
    cleanup_interval_s: float = 600


def load_settings() -> Settings:
    local_settings = Settings()
    if not local_settings.secret_id:
        return local_settings
    client = boto3.client("secretsmanager", region_name=local_settings.aws_region)
    secret_text = client.get_secret_value(SecretId=local_settings.secret_id)["SecretString"]
    secrets = {key.lower(): value for key, value in json.loads(secret_text).items()}
    return Settings(**secrets)


settings = load_settings()
