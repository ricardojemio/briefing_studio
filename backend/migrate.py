import asyncio
from core.database import engine
from domain.models import Base

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('OK')

asyncio.run(main())
