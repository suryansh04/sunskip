"""Ask SunSkip (api.md endpoint 9): Claude with SunSkip's own tools, a number check, then Hindi and voice."""

import logging
import time
from datetime import datetime

import anthropic
import httpx

from app.agent.check import problems_with
from app.agent.facts import clock, option_line
from app.agent.tools import TOOLS, ToolContext, run_tool
from app.config import IST, settings
from app.contracts.models import AgentChatRequest, AgentChatResponse, PlanRequest, RouteOption
from app.core.errors import ApiError
from app.core.http import track_service
from app.db.agent_queries import create_session, load_recent_messages, save_messages, session_exists
from app.db.trip_queries import load_trip
from app.voice.audio import ENGLISH, speak
from app.voice.sarvam import translate

TRIP_OPTIONS_SHOWN = 3
CANT_CHECK = (
    "I couldn't check SunSkip's numbers for that just now. Ask about a route, the sun on a walk, or when to leave."
)

logger = logging.getLogger(__name__)
_claude: anthropic.AsyncAnthropic | None = None

RULES = """You are SunSkip's assistant. SunSkip helps people in India walk and take buses, metros and e-rickshaws \
with fewer minutes in direct sun.
- The user may write in Hindi, Hinglish or English. Always write your answer in plain English (never Hindi or \
Hinglish), in under 60 words, plainly and kindly: SunSkip translates it into the user's language.
- Use only numbers that appear in the tool results or in the trip below. Never estimate or make up a number.
- Say times like "5 PM". Say minutes like "7.6 min".
- Never use the word "safe". Give no medical advice.
- If shade data is still being prepared, say so and suggest when to leave. If there is no shade data, say minutes \
in sun are unknown there.
- Any hour of the day can be checked, including hours already past today: the sun follows the same pattern each day.
- Questions that name no place are about the trip below, if there is one; tools use it when you leave the places out.
- If you need a destination and don't have one, ask for it. Don't apologise; just answer."""


def claude() -> anthropic.AsyncAnthropic:
    global _claude
    if _claude is None:
        _claude = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key, timeout=settings.outside_call_timeout_s, max_retries=1
        )
    return _claude


async def trip_context(context: ToolContext) -> str:
    """The trip the user is looking at, so questions about it need no tool call."""
    trip = await load_trip(context.trip_id) if context.trip_id else None
    if trip is None:
        context.trip_id = None
        return ""
    request = PlanRequest.model_validate(trip["request"])
    context.trip_places = (request.origin, request.destination)
    options = [RouteOption.model_validate(option) for option in trip["options"]][:TRIP_OPTIONS_SHOWN]
    context.summaries.append(option_line(options[0]))
    return "\n\nThe trip the user is looking at:\n" + "\n".join(option_line(option) for option in options)


def system_prompt(context: ToolContext, trip: str) -> str:
    now = datetime.now(IST)
    where = "The user's location is known." if context.location else "The user's location is not known."
    return f"{RULES}\n\nNow: {now:%A %d %B}, {clock(now)} IST. {where}{trip}"


def starts_with_question(message: dict) -> bool:
    content = message["content"]
    return message["role"] == "user" and any(block.get("type") == "text" for block in content)


def recent_history(messages: list[dict]) -> list[dict]:
    """Drops older messages until the history starts with a question, so no tool result loses its tool call."""
    while messages and not starts_with_question(messages[0]):
        messages = messages[1:]
    return messages


async def ask_claude(system: str, messages: list[dict]) -> anthropic.types.Message:
    async with track_service("claude"):
        return await claude().messages.create(
            model=settings.claude_model,
            max_tokens=settings.agent_max_tokens,
            system=system,
            messages=messages,
            tools=TOOLS,
        )


def as_content(message: anthropic.types.Message) -> list[dict]:
    return [block.model_dump(exclude_none=True) for block in message.content]


def text_of(message: anthropic.types.Message) -> str:
    return " ".join(block.text for block in message.content if block.type == "text").strip()


async def answer_tools(message: anthropic.types.Message, context: ToolContext, used: list[str]) -> dict:
    """Runs the tools Claude asked for (one after another: a planned trip feeds the next tool) as one user turn."""
    results = []
    for block in message.content:
        if block.type != "tool_use":
            continue
        used.append(block.name)
        text, failed = await run_tool(block.name, block.input, context)
        results.append({"type": "tool_result", "tool_use_id": block.id, "content": text, "is_error": failed})
    return {"role": "user", "content": results}


async def converse(system: str, turns: list[dict], context: ToolContext, question: str) -> tuple[str | None, list]:
    """Claude's checked English reply (None if none could be trusted in time) and the tools it used. `turns` grows
    with the exchange. A rejected reply and its correction are sent once, then dropped, so they're never saved."""
    started, used, retries, rounds, correction = time.monotonic(), [], 0, 0, []
    sources = [system, question, *context.summaries]  # the prompt holds the time and the trip
    while time.monotonic() - started < settings.agent_budget_s:
        message = await ask_claude(system, turns + correction)
        if message.stop_reason == "tool_use":
            rounds += 1
            if rounds > settings.agent_max_tool_rounds:
                return None, used
            correction = []  # fresh tool results replace the old complaint
            turns.append({"role": "assistant", "content": as_content(message)})
            turns.append(await answer_tools(message, context, used))
            sources += [str(turns[-1]["content"]), *context.summaries]
            continue
        reply = text_of(message)
        problem = problems_with(reply, sources)
        if not problem:
            turns.append({"role": "assistant", "content": [{"type": "text", "text": reply}]})
            return reply, used
        retries += 1
        if retries > settings.agent_max_retries:
            return None, used
        correction = [
            {"role": "assistant", "content": [{"type": "text", "text": reply}]},
            {"role": "user", "content": [{"type": "text", "text": problem}]},
        ]
    return None, used


def fallback_reply(context: ToolContext) -> str:
    """The template answer: SunSkip's own sentences for what was checked, with no model in between."""
    return " ".join(dict.fromkeys(context.summaries[-2:])) or CANT_CHECK


async def in_language(english: str, language: str) -> tuple[str, str]:
    """(reply, its language). If translating fails the English is sent, marked as English."""
    if language == ENGLISH:
        return english, ENGLISH
    try:
        return await translate(english, ENGLISH, language), language
    except httpx.HTTPError:
        logger.warning("Translating the reply failed; sending English")
        return english, ENGLISH


async def open_session(request: AgentChatRequest, client_hash: str) -> tuple:
    if request.session_id is None:
        return await create_session(client_hash, request.language), []
    if not await session_exists(request.session_id, client_hash):
        raise ApiError(404, "NOT_FOUND", "This conversation has ended. Start a new one")
    history = await load_recent_messages(request.session_id, settings.agent_history_messages)
    return request.session_id, recent_history(history)


async def chat(request: AgentChatRequest, client_hash: str) -> AgentChatResponse:
    session_id, history = await open_session(request, client_hash)
    context = ToolContext(client_hash=client_hash, location=request.location, trip_id=request.trip_id)
    system = system_prompt(context, await trip_context(context))
    question = {"role": "user", "content": [{"type": "text", "text": request.message}]}
    turns = [*history, question]
    try:
        english, used = await converse(system, turns, context, request.message)
    except anthropic.APIError as error:
        if not context.summaries:
            raise ApiError(502, "UPSTREAM_ERROR", "The assistant is not answering. Try again in a moment") from error
        english, used = None, []
    fallback = english is None
    if fallback:
        english = fallback_reply(context)
        turns = [question, {"role": "assistant", "content": [{"type": "text", "text": english}]}]
    else:
        turns = turns[len(history) :]
    reply, reply_language = await in_language(english, request.language)
    spoken = await speak(reply, reply_language, from_english=False) if request.speak else None
    await save_messages(session_id, turns, request.message, request.language)
    return AgentChatResponse(
        session_id=session_id,
        reply=reply,
        reply_language=reply_language,
        english_reply=english,
        tools_used=list(dict.fromkeys(used)),
        audio_url=spoken.audio_url if spoken else None,
        fallback=fallback,
    )
