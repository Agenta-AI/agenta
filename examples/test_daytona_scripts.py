#!/usr/bin/env python3
"""Run basic evaluator examples in Daytona sandboxes."""

from __future__ import annotations

import json
import os
from pathlib import Path

from daytona import Daytona, DaytonaConfig, CreateSandboxFromSnapshotParams


ROOT = Path(__file__).resolve().parent
BASIC_DIRS = {
    "python": ROOT / "python" / "evaluators" / "basic",
    "javascript": ROOT / "javascript" / "evaluators" / "basic",
    "typescript": ROOT / "typescript" / "evaluators" / "basic",
}


def _has_evaluate(path: Path, runtime: str) -> bool:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return False
    if runtime == "python":
        return "def evaluate" in content
    return "function evaluate" in content


def _load_files() -> dict[str, list[Path]]:
    files: dict[str, list[Path]] = {}
    for runtime, folder in BASIC_DIRS.items():
        if not folder.exists():
            continue
        pattern = "*.py" if runtime == "python" else "*.js" if runtime == "javascript" else "*.ts"
        candidates = sorted(folder.glob(pattern))
        files[runtime] = [
            path
            for path in candidates
            if path.stem != "__init__" and _has_evaluate(path, runtime)
        ]
    return files


def _wrap_js(code: str) -> str:
    params_json = json.dumps(
        {
            "app_params": {},
            "inputs": {"correct_answer": "The capital of Nauru is Yaren."},
            "output": "The capital of Nauru is Yaren.",
            "correct_answer": "The capital of Nauru is Yaren.",
        }
    )
    return (
        "const params = JSON.parse(" + repr(params_json) + ");\n"
        "const app_params = params.app_params;\n"
        "const inputs = params.inputs;\n"
        "const output = params.output;\n"
        "const correct_answer = params.correct_answer;\n"
        + code
        + "\n"
        "let result = evaluate(app_params, inputs, output, correct_answer);\n"
        "result = Number(result);\n"
        "if (!Number.isFinite(result)) { result = 0.0; }\n"
        "console.log(JSON.stringify({ result }));\n"
    )


def _wrap_python(code: str) -> str:
    params_json = json.dumps(
        {
            "app_params": {},
            "inputs": {"correct_answer": "The capital of Nauru is Yaren."},
            "output": "The capital of Nauru is Yaren.",
            "correct_answer": "The capital of Nauru is Yaren.",
        }
    )
    return (
        "import json\n"
        f"params = json.loads({params_json!r})\n"
        "app_params = params['app_params']\n"
        "inputs = params['inputs']\n"
        "output = params['output']\n"
        "correct_answer = params['correct_answer']\n"
        + code
        + "\n"
        "result = evaluate(app_params, inputs, output, correct_answer)\n"
        "if isinstance(result, (float, int, str)):\n"
        "    try:\n"
        "        result = float(result)\n"
        "    except (ValueError, TypeError):\n"
        "        result = None\n"
        "print(json.dumps({'result': result}))\n"
    )


def _parse_result(stdout: str) -> float | None:
    lines = stdout.strip().split("\n")
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and "result" in obj:
            return obj["result"]
    raise RuntimeError(f"Could not parse result from output: {stdout}")


def _run_file(daytona: Daytona, runtime: str, path: Path) -> None:
    code = path.read_text(encoding="utf-8")
    wrapped = _wrap_python(code) if runtime == "python" else _wrap_js(code)

    sandbox = daytona.create(CreateSandboxFromSnapshotParams(language=runtime))
    try:
        resp = sandbox.process.code_run(wrapped)
        result = _parse_result(resp.result)
        print(f"[{runtime}] {path.name}: {result}")
    finally:
        sandbox.delete()


def _get_config() -> DaytonaConfig:
    api_url = os.getenv("DAYTONA_API_URL", "https://app.daytona.io/api")
    api_key = os.getenv("DAYTONA_API_KEY")
    target = os.getenv("DAYTONA_TARGET", "eu")
    if not api_key:
        raise RuntimeError("DAYTONA_API_KEY is required")
    return DaytonaConfig(api_url=api_url, api_key=api_key, target=target)


def main() -> int:
    files = _load_files()
    if not files:
        print("No example files found.")
        return 1

    daytona = Daytona(config=_get_config())

    for runtime, paths in files.items():
        for path in paths:
            _run_file(daytona, runtime, path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
