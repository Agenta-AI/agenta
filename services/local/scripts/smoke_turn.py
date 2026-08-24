"""One streamed cold turn against a local runner. Slice 1 developer smoke tool.

Usage:
    uv run --no-sync python scripts/smoke_turn.py \
        --runner-url http://127.0.0.1:8011 --provider anthropic \
        --model claude-sonnet-4-5 --prompt "Say hi" [--instructions ...] [--base-url ...]

The provider key is read ONLY from f"{PROVIDER_UPPER}_API_KEY". Never logs secrets.
"""

import argparse
import asyncio
import json
import os
import sys

from agenta_local.core.agents.dtos import AgentModel, AgentRevision
from agenta_local.core.execution.dtos import (
    ExecutionCredential,
    ExecutionMessage,
)
from agenta_local.core.execution.errors import ExecutionError
from agenta_local.execution.sdk.adapter import SDKAgentExecutor

_DATA_TRUNCATE = 120


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runner-url", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--instructions", default="You are a helpful assistant.")
    parser.add_argument("--base-url", default=None)
    return parser.parse_args()


def _credential(args: argparse.Namespace) -> ExecutionCredential:
    env_key = f"{args.provider.upper()}_API_KEY"
    api_key = os.environ.get(env_key)
    if not api_key:
        print(f"error: {env_key} is not set", file=sys.stderr)
        raise SystemExit(2)
    return ExecutionCredential(
        provider=args.provider, api_key=api_key, base_url=args.base_url
    )


async def _run_turn(args: argparse.Namespace) -> int:
    revision = AgentRevision(
        id="smoke",
        version=1,
        instructions=args.instructions,
        model=AgentModel(provider=args.provider, name=args.model),
    )
    executor = SDKAgentExecutor(runner_url=args.runner_url)
    stream = executor.stream(
        revision=revision,
        messages=[ExecutionMessage(role="user", content=args.prompt)],
        credential=_credential(args),
    )
    try:
        async for event in stream.events:
            payload = event.payload
            data = json.dumps(payload.get("data"), default=str)
            if len(data) > _DATA_TRUNCATE:
                data = data[:_DATA_TRUNCATE] + "..."
            print(f"{payload.get('type')}: {data}")
        result = await stream.result()
    except ExecutionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"\nassistant_text: {result.assistant_text}")
    return 0


def main() -> int:
    args = _parse_args()
    return asyncio.run(_run_turn(args))


if __name__ == "__main__":
    sys.exit(main())
