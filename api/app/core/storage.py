from pathlib import Path

import boto3

from app.config import settings

DATA_DIR = Path(__file__).resolve().parents[2] / ".data"
_s3 = boto3.client("s3", region_name=settings.aws_region) if settings.s3_bucket else None


def save_file(key: str, content: bytes, content_type: str = "binary/octet-stream") -> None:
    path = DATA_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if _s3:
        _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=content, ContentType=content_type)


def local_path(key: str) -> Path:
    path = DATA_DIR / key
    if path.exists() or not _s3:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    _s3.download_file(settings.s3_bucket, key, str(path))
    return path


def file_exists(key: str) -> bool:
    if (DATA_DIR / key).exists():
        return True
    if not _s3:
        return False
    found = _s3.list_objects_v2(Bucket=settings.s3_bucket, Prefix=key, MaxKeys=1)
    return any(item["Key"] == key for item in found.get("Contents", []))


def file_url(key: str) -> str | None:
    """A link the browser can fetch for an hour. None without S3 (local runs): the app then speaks the text itself."""
    if not _s3:
        return None
    return _s3.generate_presigned_url(
        "get_object", Params={"Bucket": settings.s3_bucket, "Key": key}, ExpiresIn=settings.audio_url_ttl_s
    )
