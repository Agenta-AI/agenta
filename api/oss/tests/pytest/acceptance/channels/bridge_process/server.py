"""Entry point run as a real subprocess (`python -m ...server`), never
imported directly -- the harness launches this so the bridge lives in its own
process, with its own event loop, reachable only over the socket."""

import argparse
import json

import uvicorn

from oss.tests.pytest.acceptance.channels.bridge_process.app import (
    BridgeProcess,
    build_bridge_app,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--spec", type=str, required=True)
    args = parser.parse_args()

    spec = json.loads(args.spec)
    bridge = BridgeProcess(
        name=spec["name"], secret=spec["secret"], hello=spec["hello"]
    )
    app = build_bridge_app(bridge)

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
