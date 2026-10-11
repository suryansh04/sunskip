from typing import Annotated

import httpx
from fastapi import APIRouter, File, Form, Request, UploadFile

from app.config import settings
from app.contracts.models import (
    SttResponse,
    TtsRequest,
    TtsResponse,
    VoiceInstructionsRequest,
    VoiceInstructionsResponse,
)
from app.core.caps import DailyCap
from app.core.errors import ApiError
from app.voice.audio import is_cached, speak
from app.voice.directions import spoken_directions
from app.voice.listen import hear

router = APIRouter(tags=["voice"])
voice_cap = DailyCap(settings.voice_calls_per_device_per_day, settings.voice_calls_per_day)


@router.post("/voice/instructions", response_model=VoiceInstructionsResponse)
async def make_voice_instructions(body: VoiceInstructionsRequest, request: Request) -> VoiceInstructionsResponse:
    voice_cap.take(request.state.client_hash)
    return VoiceInstructionsResponse(steps=await spoken_directions(body.trip_id, body.option_id, body.language))


@router.post("/voice/tts", response_model=TtsResponse)
async def speak_text(body: TtsRequest, request: Request) -> TtsResponse:
    if len(body.text) > settings.tts_max_chars:
        raise ApiError(400, "INVALID_REQUEST", f"text must be at most {settings.tts_max_chars} characters")
    if not await is_cached(body.text, body.language, from_english=False):
        voice_cap.take(request.state.client_hash)  # audio already made costs nothing
    spoken = await speak(body.text, body.language, from_english=False)
    return TtsResponse(audio_url=spoken.audio_url, cached=spoken.cached)


@router.post("/voice/stt", response_model=SttResponse)
async def transcribe_speech(
    request: Request, audio: Annotated[UploadFile, File()], language: Annotated[str | None, Form()] = None
) -> SttResponse:
    content = await audio.read()
    if not content or len(content) > settings.stt_max_bytes:
        raise ApiError(400, "INVALID_REQUEST", "Send a voice clip of up to 30 seconds")
    voice_cap.take(request.state.client_hash)
    try:
        return await hear(content, audio.filename or "clip", audio.content_type or "audio/webm", language)
    except httpx.HTTPError as error:
        raise ApiError(502, "UPSTREAM_ERROR", "The speech service is not answering") from error
