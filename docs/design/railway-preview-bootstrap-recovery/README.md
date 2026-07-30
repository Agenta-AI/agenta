# Railway Preview Bootstrap Recovery

This design workspace describes how Railway preview setup confirms that every
required service exists before it reports success.

## Reading order

| Document | Answers |
| --- | --- |
| `context.md` | What preview users see today, why it happens, and what this work excludes. |
| `research.md` | Which scripts create and configure Railway services, and the constraints that shape the fix. |
| `plan.md` | The proposed behavior, code changes, and validation plan. |
| `status.md` | What has been implemented and what still needs validation. |

## Terms

- **Railway preview environment:** The Railway environment created for one pull
  request.
- **Bootstrap:** `hosting/railway/oss/scripts/bootstrap.sh`, which creates the
  preview environment's services and storage volumes.
- **Configure:** `hosting/railway/oss/scripts/configure.sh`, which writes
  service variables before deployment.
- **Service:** A Railway service such as `api`, `cron`, or `redis`.
