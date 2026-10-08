from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter(tags=["voice"])


@router.post("/voice/instructions")
async def make_voice_instructions():
    raise not_implemented()


@router.post("/voice/tts")
async def speak_text():
    raise not_implemented()


@router.post("/voice/stt")
async def transcribe_speech():
    raise not_implemented()
