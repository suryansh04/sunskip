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
    aws_region: str = "ap-southeast-2"
    s3_bucket: str = ""
    origin_secret_check: bool = True
    use_fakes: bool = False
    api_pool_size: int = 10
    worker_pool_size: int = 3
    shade_tiles_cached: int = 128  # decoded shade files kept in memory, ~5 MB each
    outside_call_timeout_s: float = 10
    agent_live: bool = False  # P2 turns these on once /agent/chat and /voice/* answer for real; /meta tells the app
    voice_live: bool = False

    # Walking and heat (api.md §11)
    walk_speed_mps: float = 1.2
    heat_alert_feels_like_c: float = 40
    shade_alpha: float = 3.0
    max_detour_ratio: float = 1.3
    cooler_path_min_saving_min: float = 1.0  # offer our own shadier path only if it saves this much sun
    shorter_path_min_saving_m: float = 100  # ...or if it is at least this much shorter than Google's walk
    default_wait_seconds: int = 300
    long_wait_in_sun_min: float = 5
    walk_only_max_m: float = 3000
    max_options: int = 6
    places_radius_m: float = 20000  # /places looks for names this close to the walker
    places_limit: int = 8
    swap_min_walk_m: float = 500
    swap_min_hot_sun_min: float = 5
    erickshaw_speed_mps: float = 4.2
    erickshaw_wait_seconds: int = 120
    waypoint_spacing_m: float = 25

    # Portal (api.md §8, §11); costs are estimates
    max_portal_bbox_km2: float = 25
    tree_spacing_m: float = 8
    # Estimates from Indian public figures (sources in design.md §12): an 8-10 ft neem sapling ₹120, pit and planting
    # ₹200, a municipal tree guard ₹1,280, three years of care ₹400; a powder-coated steel bus shelter ₹6.5-8 lakh
    tree_cost_inr: int = 2000
    shelter_cost_inr: int = 750000
    tree_height_m: float = 6
    tree_crown_radius_m: float = 3
    shelter_width_m: float = 3
    shelter_length_m: float = 6
    shelter_height_m: float = 3
    simulation_reach_m: float = 60  # segments this close to an item can get its shadow

    # Shade data (api.md §11, schema.md §8)
    corridor_buffer_m: float = 100
    max_cells_per_job: int = 120
    max_new_cells_per_client_per_day: int = 60
    max_shade_map_km2: float = 1
    solar_monthly_call_budget: int = 6500
    worker_solar_concurrency: int = 4
    solar_geotiffs_per_minute: int = 150  # Google's project limit is 180 a minute; stay under it
    overpass_urls: list[str] = [
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]
    representative_day: int = 15
    min_sun_elevation_deg: float = 5
    max_segment_m: float = 50
    stretch_sun_diff: float = 0.2
    # Labels for stretches with no OSM name ("Footpath by B1 Block"): how far to look for a name
    label_place_m: float = 60  # a named place this close: "by"
    label_join_m: float = 15  # a named road this close is the one it joins: "off"
    label_road_m: float = 60  # a named road this close: "near"
    label_area_m: float = 300  # else a named place this close: "near"
    shade_sample_spacing_m: float = 5
    stop_match_m: float = 30
    stop_shaded_below_sun: float = 0.5  # a stop counts as shaded when less than half of it is in sun
    graph_snap_max_m: float = 60
    privacy_grid_deg: float = 0.0005
    demand_radius_m: float = 400
    demand_decay_m: float = 150
    poll_after_seconds: int = 3

    # Voice (Sarvam) and the agent (Claude), api.md §7
    sarvam_url: str = "https://api.sarvam.ai"
    sarvam_stt_model: str = "saaras:v3"
    sarvam_translate_model: str = "mayura:v1"
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_tts_voice: str = "priya"
    audio_url_ttl_s: int = 3600
    tts_max_chars: int = 500
    stt_max_bytes: int = 5_000_000  # a 30 s clip is well under this
    voice_max_steps: int = 30
    voice_parallel_calls: int = 10
    voice_budget_s: float = 20  # steps not spoken by then are read by the app
    voice_calls_per_device_per_day: int = 60
    voice_calls_per_day: int = 3000
    claude_model: str = "claude-sonnet-5-5"
    agent_max_tool_rounds: int = 4
    agent_max_retries: int = 2
    agent_history_messages: int = 20
    agent_budget_s: float = 16  # stop asking Claude after this and answer from the numbers
    agent_max_tokens: int = 400
    agent_number_tolerance: float = 1
    agent_questions_per_device_per_day: int = 30
    agent_questions_per_day: int = 1000

    # Worker and api background loops
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
