from pathlib import Path

import boto3

from app.config import settings

DATA_DIR = Path(__file__).resolve().parents[2] / ".data"
_s3 = boto3.client("s3", region_name=settings.aws_region) if settings.s3_bucket else None


def save_file(key: str, content: bytes) -> None:
    path = DATA_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if _s3:
        _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=content)


def local_path(key: str) -> Path:
    path = DATA_DIR / key
    if path.exists() or not _s3:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    _s3.download_file(settings.s3_bucket, key, str(path))
    return path
