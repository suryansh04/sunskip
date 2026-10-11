"""Spoken sentences, made once and kept in S3: audio/{hash}.mp3 and the words it says in audio/{hash}.txt."""

import asyncio
import hashlib
import logging
from dataclasses import dataclass

import httpx

from app.config import settings
from app.core.http import describe_error
from app.core.storage import file_exists, file_url, local_path, save_file
from app.voice.sarvam import synthesize, translate

ENGLISH = "en-IN"

logger = logging.getLogger(__name__)


@dataclass
class Spoken:
    text: str  # the words in the language asked for
    audio_url: str | None  # None when the voice failed: the app speaks `text` itself
    cached: bool


def _key(text: str, language: str, from_english: bool) -> str:
    source = "en" if from_english else "as-is"
    digest = hashlib.sha256(f"{text}|{language}|{settings.sarvam_tts_voice}|{source}".encode()).hexdigest()
    return f"audio/{digest}"


def _stored(key: str) -> Spoken | None:
    if not file_exists(f"{key}.mp3"):
        return None
    return Spoken(local_path(f"{key}.txt").read_text(encoding="utf-8"), file_url(f"{key}.mp3"), cached=True)


def _store(key: str, text: str, audio: bytes) -> Spoken:
    save_file(f"{key}.txt", text.encode())
    save_file(f"{key}.mp3", audio)
    return Spoken(text, file_url(f"{key}.mp3"), cached=False)


async def is_cached(text: str, language: str, from_english: bool) -> bool:
    return await asyncio.to_thread(file_exists, f"{_key(text, language, from_english)}.mp3")


async def speak(text: str, language: str, from_english: bool) -> Spoken:
    """`text` spoken in `language`. With from_english, English text is translated first. A failed Sarvam call
    still answers: with the translation if there is one, else the English, and no audio."""
    key = _key(text, language, from_english)
    stored = await asyncio.to_thread(_stored, key)
    if stored:
        return stored
    words = text
    try:
        if from_english and language != ENGLISH:
            words = await translate(text, ENGLISH, language)
        audio = await synthesize(words, language)
    except httpx.HTTPError as error:
        logger.warning("Speech failed: %s", describe_error(error))
        return Spoken(words, None, cached=False)
    return await asyncio.to_thread(_store, key, words, audio)
