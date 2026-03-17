# Status

## Current State

- Confirmed the PR preview workflow invokes post-deploy Railway tests added in `#4016`.
- Confirmed unit and lint checks are outside the preview workflow and can remain unchanged.
- Updated `.github/workflows/14-check-pr-preview.yml` so the preview workflow stops invoking `44-railway-tests.yml` and instead records that preview tests are disabled for isolation.

## Decisions

- Keep preview deployment enabled.
- Disable only post-deploy preview test traffic for this experiment.

## Next Steps

- Open an experiment PR.
- Observe whether the preview remains stable without the post-deploy CI interaction.
