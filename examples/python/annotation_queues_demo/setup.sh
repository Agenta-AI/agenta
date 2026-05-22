#!/usr/bin/env bash
# Run all four scripts in order to populate the Agenta project with demo data
# for the annotation queues video.
#
# Requires:
#   - ~/.agenta-linkflow.env with AGENTA_API_KEY, AGENTA_HOST, OPENAI_API_KEY
#   - uv installed (https://docs.astral.sh/uv/)

set -euo pipefail
cd "$(dirname "$0")"

echo ">>> 1/4 Creating / refreshing application (Agenta Docs Bot)"
uv run -q 01_create_app.py

echo
echo ">>> 2/4 Creating / refreshing test set (Agenta FAQ)"
uv run -q 02_create_testset.py

echo
echo ">>> 3/4 Creating / refreshing human evaluators"
uv run -q 03_create_evaluators.py

echo
echo ">>> 4/4 Generating ~30 production traces"
uv run -q 04_generate_traces.py

echo
echo "Setup complete. Verify in the Agenta UI:"
echo "  - App:        Apps → agenta-docs-bot"
echo "  - Test set:   Test sets → agenta-faq (15 rows, no ground truth)"
echo "  - Evaluators: Evaluators → reference-answer + trace-correctness"
echo "  - Traces:     Observability (filter by agenta-docs-bot)"
