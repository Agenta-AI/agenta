## ADDED Requirements

### Requirement: Root opens /m
`web-mobile` SHALL answer `/` with a 307 to `/m`.

#### Scenario: Visit the root
- **WHEN** a browser requests `/`
- **THEN** the response is 307 with `Location: /m`

### Requirement: OAuth callbacks reach /m
`web-mobile` SHALL redirect `/auth/callback/<id>` to `/m/auth/callback/<id>` with the full query, for any provider id, including ids with colons.

#### Scenario: SSO callback
- **WHEN** a provider redirects to `/auth/callback/sso:acme:okta?code=c&state=s`
- **THEN** the response is 307 to `/m/auth/callback/sso:acme:okta?code=c&state=s`

### Requirement: Auth links keep their payload
`web-mobile` SHALL send every `/auth` link to the matching `/m/auth` page with its query unchanged.

#### Scenario: Password reset link
- **WHEN** a browser opens `/auth/reset-password?token=t&tenantId=public`
- **THEN** it lands on `/m/auth/reset-password?token=t&tenantId=public`

#### Scenario: Old invite link
- **WHEN** a browser opens `/auth?token=t&email=e&organization_id=o&workspace_id=w&project_id=p`
- **THEN** it lands on `/m/auth` with the same query

#### Scenario: Policy error link
- **WHEN** a browser opens `/auth?auth_error=sso_required`
- **THEN** it lands on `/m/auth?auth_error=sso_required`

### Requirement: One owner of the desktop mapping
Every legacy path that is not the root, an OAuth callback or a reset link SHALL be redirected to `/m/legacy/<path>` with its query, and `/m`'s proxy SHALL answer it with `mapDesktopToMobile` called with `developerViews: true`.

#### Scenario: SDK trace link
- **WHEN** a browser opens `/w/<ws>/p/<proj>/observability?trace=<id>`
- **THEN** it lands on the `/m` observability page for that project with `trace=<id>`

#### Scenario: SDK evaluation link without cookies
- **WHEN** a browser with no Agenta cookies opens `/w/<ws>/p/<proj>/evaluations/results/<run>`
- **THEN** it lands on `/m/w/<ws>/p/<proj>/evaluations/results/<run>`

#### Scenario: Unknown desktop path
- **WHEN** a browser opens a root path that `mapDesktopToMobile` cannot map
- **THEN** it lands on `/m` and the proxy logs the path without its query

### Requirement: Root static files
`web-mobile` SHALL answer `/favicon.ico`, `/assets/<file>` and `/robots.txt` with the `/m` copies.

#### Scenario: Tools OAuth completion page icon
- **WHEN** the API page at `tools/router.py` renders its favicon
- **THEN** the image URL resolves to a file

### Requirement: Temporary redirects only
Every legacy redirect SHALL use status 307.

#### Scenario: No cached redirect
- **WHEN** any legacy redirect is returned
- **THEN** its status is 307, never 301 or 308

### Requirement: No Classic mode bounce
`/m` SHALL NOT redirect any user to a desktop path, whatever cookies the browser holds.

#### Scenario: Old classic cookie
- **WHEN** a browser with `agenta-classic-mode=1` opens `/m`
- **THEN** `/m` renders and does not redirect to `/w`
