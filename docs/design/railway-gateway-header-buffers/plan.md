# Plan

1. Update `hosting/railway/oss/gateway/nginx.conf` with explicit upstream proxy buffer sizes.
2. Keep the change scoped to the Railway gateway used by preview deploys and CI.
3. Review the diff to confirm no unrelated deployment behavior changes.
4. Commit on a dedicated branch and open a PR describing the workflow regression trigger and gateway fix.
5. Watch CI results, especially Railway preview/auth-related checks, and confirm whether the auth refresh error disappears.
