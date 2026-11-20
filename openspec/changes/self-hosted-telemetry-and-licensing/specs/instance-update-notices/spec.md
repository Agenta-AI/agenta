# Instance update notices

## Purpose

Tell people on any Agenta instance, cloud or self-hosted, when a new version or a security fix exists, what is new, and about upgrades, from inside the product. Reuse what exists today instead of building a second system.

Today (origin/main `ce68eea1af`): `/m` already has a "What's new" dialog (`web/mobile/src/features/education/WhatsNewDialog.tsx`) and a "What's new?" block in the help menu (`web/packages/agenta-navigation-ui/src/releaseItems.tsx`). Both read `RELEASES` from `web/packages/agenta-navigation/src/releases/changelog.json`, which `pnpm generate:releases` builds from the docs changelog entries. "Seen" state lives in `web/packages/agenta-navigation/src/releases/seen.ts`. The list is bundled into the web build, so an instance only knows the releases up to its own version. That is fine on cloud and blind on a self-hosted instance that is behind.

## ADDED Requirements

### Requirement: One release feed from the existing changelog
The release feed SHALL be a static file at `https://agenta.ai/releases.json` that the website build makes from the same output of `pnpm generate:releases`: `{"releases": Release[], "notices": Notice[]}`. `Release` SHALL keep its shape and gain one optional field, `securityFix: true`, set when a docs entry of that version has the tag `security`. Notices SHALL come from one hand-written file next to `changelog.json`. There SHALL be no second changelog source.

#### Scenario: A release ships
- **WHEN** a release adds a docs changelog entry, runs `pnpm generate:releases`, and merges to `main`
- **THEN** the bundled list and the published feed SHALL contain the same release with the same fields

### Requirement: Cloud and self-hosted use the same route
Cloud and self-hosted instances SHALL read releases through `GET /instance/releases` and the same browser code. The API SHALL fetch the feed at most every 12 hours, cache it, and return it with the running version. The browser SHALL merge the feed with the bundled list, so the existing "What's new" dialog and help-menu block show releases newer than the running version. When the feed is off or unreachable, the browser SHALL use the bundled list alone, as today.

#### Scenario: Self-hosted instance behind
- **WHEN** a self-hosted instance runs v0.127.3 and the feed lists v0.128.0
- **THEN** the existing "What's new" dialog SHALL show v0.128.0 with the same layout as on cloud

#### Scenario: Feed unreachable
- **WHEN** the feed cannot be reached
- **THEN** the dialog SHALL show the bundled list, no update marker SHALL show, and the API SHALL log one warning per failed fetch

### Requirement: Update check setting
The feed request SHALL be a plain GET that carries no instance id, no version and no other data about the instance. It SHALL be on by default and SHALL stop when `AGENTA_UPDATE_CHECK_ENABLED=false`. It SHALL NOT follow `AGENTA_TELEMETRY_ENABLED`. The docs SHALL say that the check downloads the feed and sends nothing about the instance.

#### Scenario: Update check off
- **WHEN** `AGENTA_UPDATE_CHECK_ENABLED=false`
- **THEN** the instance SHALL make no request to the feed and SHALL behave as today

### Requirement: Version form
Every version in the feed and the route SHALL use the `Release.id` form, `v<major>.<minor>.<patch>`. The browser SHALL compare versions with one function in `@agenta/navigation`, by number, not as text.

#### Scenario: Ordering
- **WHEN** the browser compares v0.128.10 with v0.128.9
- **THEN** v0.128.10 SHALL count as newer

### Requirement: Update available
When the feed lists a version newer than the running version, the help menu SHALL show a small "Update available" marker, and its "What's new?" block SHALL mark the newer releases and link to the upgrade guide. The feed is published after the production deploy, so the marker SHALL NOT show on cloud.

#### Scenario: Two releases behind
- **WHEN** the instance runs v0.127.3 and the feed lists v0.128.0 and v0.128.1
- **THEN** the marker SHALL show, and the list SHALL show both releases, newest first, marked as not installed

### Requirement: Security update warning
When the running version is below a release with `securityFix: true`, organization owners and admins SHALL see a warning that stays until they close it, naming the newest such release. It SHALL come back after 7 days while the instance still runs a version below it. The generator SHALL keep the newest security release in the list even when it is older than the last 10 versions.

#### Scenario: Owner on an affected version
- **WHEN** an owner signs in on a version below a security release
- **THEN** they SHALL see "Security update available. Upgrade to <version> or later." with a link to the notes

### Requirement: Targeted notices
Each notice SHALL have `id`, `title`, `body`, `link`, `severity` (`info` or `warning`), and optional filters `editions` (`oss`, `ee`), `plans` (plan slugs), `minVersion` and `maxVersion`. The browser SHALL show only notices whose filters all match, in the help menu next to "What's new?", and SHALL remember dismissed notices the way `seen.ts` remembers seen releases.

#### Scenario: Enterprise trial notice
- **WHEN** the feed has a notice for `plans: ["self_hosted_community"]`
- **THEN** only self-hosted instances with no key SHALL show it, and cloud SHALL NOT
