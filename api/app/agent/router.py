from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter(tags=["agent"])


@router.post("/agent/chat")
async def chat_with_agent():
    raise not_implemented()
