# Browser agent tools

## Purpose

Give the agent a small, safe set of browser actions that work the same way in every harness.

## ADDED Requirements

### Requirement: Tool set
When an agent config names a browser profile, Agenta SHALL give the agent these browser tools: `navigate`, `read_page`, `find`, `form_input`, `left_click`, `type`, `screenshot`, `upload`, `pay`, `delete`, and `wait_for_user`. Tool names and inputs SHALL follow Anthropic's browser toolset where a tool of the same name exists there.

#### Scenario: Agent with a profile
- **WHEN** a run starts for an agent whose config names a browser profile
- **THEN** the agent SHALL see the browser tools in its tool list

#### Scenario: Agent without a profile
- **WHEN** a run starts for an agent whose config names no browser profile
- **THEN** the agent SHALL NOT see the browser tools

### Requirement: Element references only
`read_page` and `find` SHALL return page elements with stable element references. `left_click`, `form_input`, `type`, `upload`, `pay`, and `delete` SHALL act on an element reference. No browser tool SHALL accept screen coordinates.

#### Scenario: Click by reference
- **WHEN** `read_page` returns a button with reference `ref_12` and the agent calls `left_click` with `ref_12`
- **THEN** the browser SHALL click that button

#### Scenario: Coordinates refused
- **WHEN** the agent calls `left_click` with an x and y position
- **THEN** the call SHALL fail with `invalid_arguments`, `retryable: false`, and a `next_step` that tells the agent to use an element reference

### Requirement: Same tools in every harness
Agenta SHALL deliver the browser tools to Pi, Claude, and Codex through the platform tool path, so that every harness reaches the same server-side handler.

#### Scenario: Same call from two harnesses
- **WHEN** a Pi agent and a Claude agent each call `navigate` with the same URL and profile
- **THEN** both calls SHALL reach the same handler and produce the same step-log entry shape

### Requirement: The model cannot choose the profile
The browser tools SHALL NOT take a profile argument. Agenta SHALL resolve the profile on the server from the run's agent revision and the run's user.

#### Scenario: Model passes a profile ID
- **WHEN** the model adds a `profile_id` field to a browser tool call
- **THEN** Agenta SHALL ignore that field and use the profile resolved from the run

### Requirement: Approval defaults
`pay` and `delete` SHALL ask the user for approval by default. The other browser tools SHALL run without approval by default. The agent author SHALL be able to change these defaults per tool, as for other tools.

#### Scenario: Agent pays
- **WHEN** the agent calls `pay` on a checkout button
- **THEN** the turn SHALL pause on an approval before the click runs

#### Scenario: Agent submits a form
- **WHEN** the agent clicks a form's submit button with `left_click`
- **THEN** the click SHALL run without approval

### Requirement: Payments and deletes are best effort
Agenta SHALL instruct the agent to use `pay` for any payment or purchase and `delete` for any deletion. Agenta SHALL NOT claim to detect a payment or deletion done through another tool. Every browser action SHALL be in the step log.

#### Scenario: Agent clicks a pay button with left_click
- **WHEN** the agent clicks a "Pay now" button with `left_click` instead of `pay`
- **THEN** the click SHALL run without approval and SHALL appear in the step log

### Requirement: Google logins
Agenta SHALL instruct the agent never to type credentials into a Google sign-in page. When a site needs "Sign in with Google", the agent SHALL call `wait_for_user` so that the user signs in through the live view. Gmail, Google Calendar, and Google Drive tasks SHALL use the existing connectors, not the browser.

#### Scenario: Google sign-in page
- **WHEN** the agent reaches a page on `accounts.google.com` during a run
- **THEN** the agent SHALL call `wait_for_user` and SHALL NOT type into the page

### Requirement: Agent-actionable errors
Every browser tool failure that Agenta authors SHALL use the envelope `{code, message, retryable, next_step?, details?}`. The v1 codes SHALL include `profile_not_available`, `profile_needs_login`, `site_not_allowed`, `element_not_found`, `file_not_in_session`, `invalid_arguments`, and `browser_unavailable`.

#### Scenario: Element no longer on the page
- **WHEN** the agent clicks a reference that is no longer on the page
- **THEN** the call SHALL fail with `element_not_found`, `retryable: false`, and a `next_step` that tells the agent to call `read_page` again
