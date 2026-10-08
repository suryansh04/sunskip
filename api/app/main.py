import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.agent.router import router as agent_router
from app.conditions.router import router as conditions_router
from app.config import settings
from app.core.errors import add_error_handlers
from app.core.http import close_http_client
from app.core.middleware import guard_request
from app.db.cleanup import run_cleanup_forever
from app.db.pool import close_pool, open_pool
from app.health.router import router as health_router
from app.meta.router import router as meta_router
from app.portal.router import router as portal_router
from app.routes.router import router as routes_router
from app.shade.router import router as shade_router
from app.voice.router import router as voice_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await open_pool(settings.api_pool_size)
    cleanup_task = asyncio.create_task(run_cleanup_forever())
    yield
    cleanup_task.cancel()
    await close_http_client()
    await close_pool()


app = FastAPI(title="SunSkip API", version="1", lifespan=lifespan)
app.middleware("http")(guard_request)
add_error_handlers(app)
for router in (
    meta_router,
    health_router,
    conditions_router,
    shade_router,
    routes_router,
    agent_router,
    voice_router,
    portal_router,
):
    app.include_router(router, prefix="/v1")
