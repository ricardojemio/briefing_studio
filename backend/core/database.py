import asyncio
import logging
import os

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from core.config import settings

log = logging.getLogger(__name__)

engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def create_tables(max_attempts: int = 10, initial_delay: float = 1.0, max_delay: float = 10.0) -> None:
    delay = initial_delay
    for attempt in range(1, max_attempts + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            if attempt > 1:
                log.info("create_tables: connected on attempt %d/%d", attempt, max_attempts)
            return
        except Exception as exc:
            if attempt == max_attempts:
                log.critical(
                    "create_tables: giving up after %d attempts, last error: %s", attempt, exc,
                )
                # uvicorn's --reload supervisor does not exit when the worker's
                # lifespan raises (it just waits for the next file change), so a
                # plain `raise` here would leave the container half-alive again,
                # as observed in production. os._exit() kills the whole process
                # so the container actually stops and `restart: unless-stopped`
                # can bring it back up.
                os._exit(1)
            log.warning(
                "create_tables: attempt %d/%d failed (%s), retrying in %.1fs",
                attempt, max_attempts, exc, delay,
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, max_delay)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
