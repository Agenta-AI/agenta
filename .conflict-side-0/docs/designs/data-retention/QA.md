# QA: Data Retention

## Functional checks
- Verify logs show per-plan retention cutoff and deletion counts.
- Confirm old traces are removed and newer traces remain.

## Edge cases
- No projects for a plan (should log skip/zero counts).
- Unlimited retention (plan should be skipped).
- Large batch sizes (ensure job completes under cron timeout).

## Monitoring
- Check logs for `flush` start/end markers.
- Track DB load during retention run.
