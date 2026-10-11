from uuid import UUID

from app.db.pool import get_pool


async def create_session(client_hash: str, language: str) -> UUID:
    return await get_pool().fetchval(
        "INSERT INTO agent_sessions (client_hash, language) VALUES ($1, $2) RETURNING id", client_hash, language
    )


async def session_exists(session_id: UUID, client_hash: str) -> bool:
    found = await get_pool().fetchval(
        "SELECT 1 FROM agent_sessions WHERE id = $1 AND client_hash = $2", session_id, client_hash
    )
    return found is not None


async def load_recent_messages(session_id: UUID, limit: int) -> list[dict]:
    """The last `limit` messages, oldest first, as Claude content ({role, content})."""
    rows = await get_pool().fetch(
        """
        SELECT role, content FROM (
            SELECT id, role, content FROM agent_messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2
        ) recent ORDER BY id
        """,
        session_id,
        limit,
    )
    return [{"role": row["role"], "content": row["content"]} for row in rows]


async def save_messages(session_id: UUID, messages: list[dict], original_text: str, language: str) -> None:
    """Saves one exchange; the user's own words (before any translation) go with the first message."""
    async with get_pool().acquire() as connection, connection.transaction():
        for index, message in enumerate(messages):
            await connection.execute(
                "INSERT INTO agent_messages (session_id, role, content, original_text, language) "
                "VALUES ($1, $2, $3, $4, $5)",
                session_id,
                message["role"],
                message["content"],
                original_text if index == 0 else None,
                language if index == 0 else None,
            )
        await connection.execute("UPDATE agent_sessions SET last_active_at = now() WHERE id = $1", session_id)
