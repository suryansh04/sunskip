"""Sarvam AI: speech to text, translation and the Bulbul voice. Plain HTTP through the shared client."""

import base64

from app.config import settings
from app.core.http import http_client, track_service

KEEP_DIGITS = "international"  # numbers stay 0-9 in Hindi, so "7.6 min" survives translation


def _headers() -> dict:
    return {"api-subscription-key": settings.sarvam_api_key}


async def transcribe(audio: bytes, filename: str, content_type: str) -> tuple[str, str | None]:
    """(what was said, the language it was said in, or None if Sarvam couldn't tell)."""
    files = {"file": (filename, audio, content_type)}
    data = {"model": settings.sarvam_stt_model, "mode": "transcribe", "language_code": "unknown"}
    async with track_service("sarvam"):
        response = await http_client.post(
            f"{settings.sarvam_url}/speech-to-text", headers=_headers(), files=files, data=data
        )
        response.raise_for_status()
    answer = response.json()
    return answer["transcript"], answer.get("language_code")


async def translate(text: str, source_language: str, target_language: str) -> str:
    body = {
        "input": text,
        "source_language_code": source_language,
        "target_language_code": target_language,
        "model": settings.sarvam_translate_model,
        "numerals_format": KEEP_DIGITS,
    }
    async with track_service("sarvam"):
        response = await http_client.post(f"{settings.sarvam_url}/translate", headers=_headers(), json=body)
        response.raise_for_status()
    return response.json()["translated_text"]


async def synthesize(text: str, language: str) -> bytes:
    """MP3 of the text spoken in the language."""
    body = {
        "text": text,
        "language_code": language,
        "model": settings.sarvam_tts_model,
        "speaker": settings.sarvam_tts_voice,
        "output_audio_codec": "mp3",
    }
    async with track_service("sarvam"):
        response = await http_client.post(f"{settings.sarvam_url}/text-to-speech", headers=_headers(), json=body)
        response.raise_for_status()
    return base64.b64decode(response.json()["audios"][0])
