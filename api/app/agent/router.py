from fastapi import APIRouter, Request

from app.agent.chat import chat
from app.config import settings
from app.contracts.models import AgentChatRequest, AgentChatResponse
from app.core.caps import DailyCap

router = APIRouter(tags=["agent"])
question_cap = DailyCap(settings.agent_questions_per_device_per_day, settings.agent_questions_per_day)


@router.post("/agent/chat", response_model=AgentChatResponse)
async def chat_with_agent(body: AgentChatRequest, request: Request) -> AgentChatResponse:
    question_cap.take(request.state.client_hash)
    return await chat(body, request.state.client_hash)
