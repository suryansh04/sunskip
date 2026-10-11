"""What the walker said (api.md endpoint 12): the words, their language, and the English."""

from app.contracts.models import SttResponse
from app.voice.audio import ENGLISH
from app.voice.sarvam import transcribe, translate


async def hear(audio: bytes, filename: str, content_type: str, language: str | None) -> SttResponse:
    transcript, detected = await transcribe(audio, filename, content_type)
    spoken_in = detected or language or ENGLISH
    english = transcript if spoken_in == ENGLISH or not transcript else await translate(transcript, spoken_in, ENGLISH)
    return SttResponse(transcript=transcript, language=spoken_in, english=english)
