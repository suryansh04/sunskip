"""What the walker said (api.md endpoint 12): the words, their language, and the English."""

import logging

import httpx

from app.contracts.models import SttResponse
from app.core.http import describe_error
from app.voice.audio import ENGLISH
from app.voice.sarvam import transcribe, translate

logger = logging.getLogger(__name__)


async def english_of(transcript: str, language: str) -> str:
    """The transcript in English. Speech can be heard in more languages than it can be translated from, so if
    translating fails the words are given as they were said."""
    if language == ENGLISH or not transcript:
        return transcript
    try:
        return await translate(transcript, language, ENGLISH)
    except httpx.HTTPError as error:
        logger.warning("Translating what was said failed: %s", describe_error(error))
        return transcript


async def hear(audio: bytes, filename: str, content_type: str, language: str | None) -> SttResponse:
    transcript, detected = await transcribe(audio, filename, content_type)
    spoken_in = detected or language or ENGLISH
    return SttResponse(transcript=transcript, language=spoken_in, english=await english_of(transcript, spoken_in))
