"""Checks a reply before it reaches the user: every number must come from SunSkip's own answers, and it must never
call anything "safe" (api.md endpoint 9, step 5)."""

import re

from app.config import settings

NUMBER = re.compile(r"\d+(?:\.\d+)?")
THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")  # "1,200" is one number
SAFE_WORD = re.compile(r"\bsafe", re.IGNORECASE)
MARKDOWN = re.compile(r"\*\*|__|^\s*(?:[-*•]|\d+\.)\s|^\s*#", re.MULTILINE)
QUIET = "Reply with the new answer only; don't apologise or mention this note."


def numbers_in(text: str) -> list[float]:
    return [float(found) for found in NUMBER.findall(THOUSANDS.sub("", text))]


def unbacked_numbers(reply: str, sources: list[str]) -> list[float]:
    """Numbers in the reply that aren't within the tolerance of any number in the sources."""
    known = [number for source in sources for number in numbers_in(source)]
    return [
        number
        for number in numbers_in(reply)
        if not any(abs(number - source) <= settings.agent_number_tolerance for source in known)
    ]


def problems_with(reply: str, sources: list[str], cut_off: bool) -> str | None:
    """What is wrong with the reply, in words Claude can act on, or None when it can be sent."""
    if cut_off or not reply:
        return "Your answer was cut off. Answer again in under 60 words. " + QUIET
    if len(reply.split()) > settings.agent_max_words or MARKDOWN.search(reply):
        return "Rewrite the answer in under 60 words, as plain sentences with no lists, bold or headings. " + QUIET
    if SAFE_WORD.search(reply):
        return "Rewrite the answer without the word 'safe' or 'safety'; give minutes in direct sun instead. " + QUIET
    wrong = unbacked_numbers(reply, sources)
    if wrong:
        listed = ", ".join(f"{number:g}" for number in wrong)
        return (
            f"Rewrite the answer: these numbers aren't in the tool results: {listed}. Use only numbers from them. "
            + QUIET
        )
    return None
