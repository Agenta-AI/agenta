# Third-Party Subsystem Access Patterns

How `api/` code should reach external subsystems (Postgres, Redis, Stripe, PostHog,
SuperTokens, SendGrid, …), why the patterns differ, and what the current state is.

Authored 2026-05-21 from a read-only audit of the `api/` tree plus the decisions
made while fixing UEL-024 and UEL-027 (see
`docs/designs/unified-eval-loops/findings.md`).

## Intent

There is **no single DI story**, and that is deliberate. Forcing one uniform
pattern across every subsystem fights both the libraries (some are module
singletons, some are instantiated clients) and the call shape (some deps are
required on every request, some are optional one-liners). Instead, the access
pattern is chosen by classifying each subsystem along **two axes**:

1. **Required vs optional** — is the dependency needed for the app to function on
   every request, or is it an optional integration that may be disabled/absent?
2. **Per-request client vs boot-time framework vs shared-orchestration** — how is
   the dependency used at the call site?

The goal: testability (a swappable seam), no eager work at import time for
optional deps, and not duplicating orchestration that several callers share.

## The model (decision table)

| Subsystem | Required? | Call shape | Pattern | Rationale |
|-----------|-----------|------------|---------|-----------|
| **Postgres / SQLAlchemy** | required | per-request client | **Lazy singleton factory + constructor injection** | Modern DAOs take `engine=None` and fall back to `get_transactions_engine()`. The factory is a lazy singleton; the constructor param is the test seam. |
| **Redis / cache** | required-ish | per-request, but always behind helpers | **Lazy singleton factory + util wrapper** | Callers never touch the Redis client — they call `get_cache`/`set_cache` in `caching.py`, backed by a module-global lazy engine. |
| **Stripe** | optional | one-liner direct calls (`stripe.Customer.create`) | **Lazy loader, direct use** | `_load_stripe()` returns the module (with `api_key` set), or `None`. No shared orchestration → no util wrapper; callers use it directly and null-check. |
| **PostHog** | optional | one-liner direct calls (`posthog.capture`) | **Lazy loader, direct use** | Same as Stripe. `_load_posthog()` returns the module or `None`. |
| **SendGrid (email)** | optional | shared orchestration (load template → format → validate sender → send) | **Lazy loader + util wrapper** | Email callers share real glue, so it belongs behind a util like Redis behind `caching.py`. `_load_sendgrid()` returns a client instance; `emailing.send_email(...)` is the public entry. |
| **Loops (marketing contacts)** | optional | single HTTP POST | **Util wrapper, direct HTTP (no client to load)** | Not an SDK — a raw `httpx` call to the Loops API. Nothing to lazy-load; lives in `emailing.py` as `add_contact(...)` (same outbound surface as email), enabled-guarded on `env.loops.enabled`. |
| **SuperTokens** | required | boot-time framework | **Eager conditional init at startup** | Not a per-request client — a framework that registers global middleware/recipes. Initialized once via `init_supertokens()` at app boot. DI/lazy would add nothing. |

### The three loader/access shapes, concretely

- **Constructor injection (Postgres):**
  ```python
  class MetersDAO:
      def __init__(self, engine: TransactionsEngine = None):
          self.engine = engine or get_transactions_engine()
  # tests: MetersDAO(engine=mock_engine)
  ```
- **Lazy loader, direct use (Stripe / PostHog):**
  ```python
  stripe = _load_stripe()          # None if disabled/unavailable
  if stripe is None: return
  stripe.Customer.create(...)
  # tests: monkeypatch the loader, e.g. _load_posthog
  ```
- **Lazy loader + util wrapper (Redis, SendGrid):**
  ```python
  # callers never see the client:
  await get_cache(...) ; await set_cache(...)          # caching.py
  await emailing.send_email(to_email=..., subject=...)  # emailing.py
  ```

## Cross-cutting rules (decided)

1. **Each `lazy.py` loader owns its enabled-check** and returns `None` when the
   subsystem is disabled/unavailable; callers null-check the result. (SendGrid
   does this now. Stripe/PostHog still gate `if env.X.enabled` at call sites — see
   "Known gaps" — but the intended direction is loader-owns-it.)
2. **Loaders return whatever the library is designed for.** `stripe`/`posthog`
   return the module (global `api_key`); `sendgrid` returns a client instance. Do
   **not** force uniformity against the library's own shape.
3. **Optional deps must not do work at import time.** No module-global client
   construction (the UEL-027 anti-pattern). Build on first use via the loader.
4. **Wrap in a util only when callers share orchestration.** One-liner deps
   (Stripe/PostHog) use the loader directly. Deps with shared glue (Redis, email)
   get a util so the glue isn't duplicated across call sites.
5. **Don't add production "proxy globals" just to satisfy tests.** Patch the real
   seam (constructor, or the loader/factory function). This is the UEL-024 lesson.

## Current state (2026-05-21)

- **Postgres:** consistent. Modern DAOs (`MetersDAO`, `SecretsDAO`, `ToolsDAO`,
  `EvaluationsDAO`, `GitDAO`, `IdentitiesDAO`, EE `EventsDAO`/`OrganizationsDAO`/
  `SubscriptionsDAO`, `TracingDAO` on `AnalyticsEngine`) all use constructor
  injection with factory fallback. Engines wired once at
  `api/entrypoints/routers.py` (~lines 398-401). Legacy `db_manager`/
  `db_manager_ee` call `get_transactions_engine()` inline per-function (factory
  lookup, no injectable seam) — acceptable for legacy that is being replaced.
- **Redis:** `caching.py` module-global lazy engine + helper functions. Clean
  isolation; no DAO takes Redis as a constructor param.
- **Stripe / PostHog:** `_load_stripe` / `_load_posthog` in
  `oss/src/utils/lazy.py`; used directly in services (`subscriptions/service.py`,
  `meters/service.py`, `auth/helper.py`, `auth/supertokens/overrides.py`,
  `analytics_service.py`).
- **SendGrid:** fixed in UEL-027. `_load_sendgrid()` added to `lazy.py`;
  `oss/src/utils/emailing.py` is the util (public `send_email`, private
  `_read_email_template` / `_render_email_template`); template at
  `oss/src/utils/templates/send_email.html`. The old
  `oss/src/services/email_service.py` and the dead eager `sg` in `db_manager_ee.py`
  were removed. Four call sites migrated to `emailing.send_email(...)`.
- **SuperTokens:** `init_supertokens()` at startup (`routers.py` ~line 189).

## Known gaps / follow-ups (not yet done)

- **Stripe/PostHog enabled-check still at call sites.** Per rule 1 it should move
  into the loaders (return `None` when disabled). ~5 call sites; not migrated to
  avoid unprompted churn.
- **Email render-per-recipient.** The EE `notify_org_admin_invitation` loop calls
  `emailing.send_email` per admin, re-rendering identical HTML each time. Cheap;
  could split render-once if it ever matters.
- **Legacy `db_manager_ee` has no injectable seam.** Fine while it is slated for
  replacement; if it survives, class-ify it or thread `engine` through.

## Tradeoffs considered (and rejected)

- **One uniform DI everywhere.** Rejected: fights library shapes (module vs
  client) and over-engineers optional one-liner deps.
- **Fully unpacking `email_service` to inline `sg.send` at every call site (to
  match Stripe/PostHog).** Rejected: the four email callers share template +
  format + sender-validation glue; inlining would duplicate ~10 lines ×4. Email is
  a caching-style boundary, not a one-liner dep.
- **Forcing Stripe/PostHog loaders to return wrapped client objects** for surface
  uniformity. Rejected: works against how those libraries are built (module
  singletons with a global `api_key`).
- **Adding module-level proxy globals so existing tests' `monkeypatch` targets
  keep working (UEL-024).** Rejected: hides the real seam and degrades production
  code; tests were updated to patch the actual seam instead.
