<!-- review-loop: design=3a864fd9c1ab lenses=simplify,naming -->

**Review loop result** for the one-image design at repo commit `9f7fc1cc42` (branch `feat/self-hosted-free-key`), 3 rounds plus one check of the round 3 fixes. An earlier review of the first design (key check moved into MIT code) ended Low on both lenses; that design was replaced when Mahmoud chose one image.

| Lens | Final rating |
| --- | --- |
| Simplify | Low (check after round 3) |
| Naming | Low (round 3, its one Low finding fixed) |

**Fixed:**
- The membership step for an adopted open source database runs before the enterprise tables are created, so an interrupted first start repeats it instead of skipping it.
- `AGENTA_LICENSE` had several meanings. The API reads it only as the database prefix fallback, `/m` stops reading it, and in the web image it only picks the classic `/w` build.
- The migration runner picks the legacy core and tracing chains from the database, ignores the ini path variables, and checks the revision before any other step. The `ee` runner owns the sequence and the `oss` module only calls it.
- A fresh database keeps the existing schema bootstrap.
- Both limits sit in the entitlements domain: a new `self_hosted_community` row in `PROJECT_LIMITS`, and `ORGANIZATION_LIMITS` next to it.
- `is_ee()` and `is_oss()` say in their docstrings that they mean "the `ee` code is present".
- Analytics: new event `self_hosted_deployment_created` and sign-up property `is_cloud`; `OSS_CONFIG` becomes `SELF_HOSTED_CONFIG`.
- The web image has one cloud value: `isCloud()` reads the existing billing value, and `isBillingEnabled()` calls it.
- `InstanceOrganizationLimitReachedError` is its own class; install and admin names are consistent.

**Left on purpose:**
- A new install whose first start stops partway through the legacy core chain is refused on the next start. The message tells the operator to delete the empty databases and start again. This is a documented limit, not extra code.
- The flat error shape `{code, message, limit}` stays, like `vault` and `mounts`.

After the record, the spec changed only to record Mahmoud's answers to questions 6, 7 and 8 (the options the reviewed spec already used) and to add the approved Enterprise License wording. The design shape did not change, so no new round ran.
