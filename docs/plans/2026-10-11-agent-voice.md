# Agent and voice: design and plan (11 Oct 2026)

Builds api.md endpoints 9–12, which the app's chat, mic and spoken directions already call. Decided with the user on 11 Oct.

## Decisions

- **Keys:** `ANTHROPIC_API_KEY` and `SARVAM_API_KEY` in `sunskip/prod` (and the local `.env`), added by the user.
- **Claude:** `claude-sonnet-5-5`, up to 4 tool rounds, ~20 s budget, then the template answer.
- **Hindi:** Claude reads the question as typed (Hindi, Hinglish or English) and answers in English (the number check runs on it); Sarvam translates only the answer to Hindi. This replaces api.md step 1 (translate the question first).
- **Sarvam** (plain httpx, no SDK): speech-to-text `saaras:v3` (`transcribe`), translate `mayura:v1` (digits kept 0–9), text-to-speech `bulbul:v3`, voice `priya`, MP3.
- **Audio cache:** S3 `audio/{sha256}.mp3` + `.txt` (the spoken text), presigned for 1 h. Made once per sentence, language and voice.
- **Caps (in memory; one api process):** voice 20 calls per device and 200 in total per day; agent 10 questions per device and 100 in total per day (lowered for the demo). Cached audio doesn't count. Over the cap: `429 RATE_LIMITED`.
- **Agent plans** are real trips: `plan_route` runs the normal planner, so they are saved and logged like any plan.
- **No schema change:** sessions use the existing `agent_sessions` / `agent_messages` tables.

## PR 1: voice

- `core/caps.py`: daily per-device and total counters.
- `core/storage.py`: `read_text`, `presigned_url`, `exists`.
- `voice/sarvam.py`: `transcribe`, `translate`, `synthesize`.
- `voice/audio.py`: `spoken(text, language, translate)` → (text, audioUrl, cached).
- `voice/directions.py`: steps from the trip's waypoints: one per straight run ("Head south along X for 50 m. Then turn right."), with a shade note, the arrival, at most 30.
- `voice/router.py`: `/voice/instructions`, `/voice/tts`, `/voice/stt`.
- Settings in `config.py`, models in `contracts/models.py`, `python-multipart` in requirements, docs (api.md, TRD).
- Test: curl each endpoint with real keys; a walk on the phone with `VOICE_LIVE=true`.

## PR 2: agent

- `db/agent_queries.py`: sessions and messages.
- `agent/tools.py`: `plan_route`, `find_best_time`, `get_conditions`, `explain_segment`, each returning a short text summary (times as "5 PM").
- `agent/check.py`: number check (±1 against tool results, the trip summary and the question), no "safe", template answer.
- `agent/chat.py`: the loop, trip context in the system prompt, translate + speak the answer.
- `agent/router.py`: `/agent/chat`.
- Test: the suggested questions in English and Hindi, by text and voice, with and without a trip.
