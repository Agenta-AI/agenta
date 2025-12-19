# Agenta import time benchmark

This document captures manual measurements of `import agenta` before and after the changes in `[AGE-3512] fix(sdk): Speed up agenta import time`.

## Test command

All measurements were taken from the repository root on Python 3.11 using:

```bash
PYTHONPATH=sdk python - <<'PY'
import time
start=time.perf_counter()
import agenta
print(f"import time: {time.perf_counter()-start:.3f}s")
PY
```

Each run was executed in a fresh Python process with the listed commit checked out.

## Results

| Commit | Description | Run 1 | Run 2 | Run 3 | Approx. average |
| --- | --- | ---: | ---: | ---: | ---: |
| `bd1d93f2` | Before deferred runner import | 10.967s | 10.534s | 10.006s | ~10.5s |
| `38a46651` | After deferred runner import | 3.836s | 3.832s | 3.683s | ~3.8s |

The optimization reduced the cold import time by roughly **6.7 seconds** (~64% faster).
