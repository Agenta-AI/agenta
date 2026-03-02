import asyncio
import traceback

import click
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def migration_update_workflow_revision_uris(
    sqlalchemy_url: str,
):
    """Update workflow revision URIs from agenta:built-in: to agenta:builtin:"""
    try:
        engine = create_async_engine(url=sqlalchemy_url)
        async with engine.connect() as connection:
            # Update URIs in the data JSON column
            # The data column contains JSON with a "uri" field like "agenta:built-in:echo:v0"
            update_query = text("""
                UPDATE workflow_revisions
                SET data = jsonb_set(
                    data::jsonb,
                    '{uri}',
                    to_jsonb(replace(data->>'uri', 'agenta:built-in:', 'agenta:builtin:'))
                )
                WHERE data->>'uri' LIKE 'agenta:built-in:%'
            """)

            result = await connection.execute(update_query)
            await connection.commit()

            click.echo(
                click.style(
                    f"Updated {result.rowcount} workflow revision URIs from 'agenta:built-in:' to 'agenta:builtin:'",
                    fg="green",
                )
            )

    except Exception as e:
        click.echo(f"Error occurred: {e}")
        click.echo(click.style(traceback.format_exc(), fg="red"))


def run_migration(sqlalchemy_url: str):
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(
            asyncio.run,
            migration_update_workflow_revision_uris(sqlalchemy_url),
        )
        future.result()
