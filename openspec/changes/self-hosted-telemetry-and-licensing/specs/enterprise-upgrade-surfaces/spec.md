# Enterprise upgrade surfaces

## Purpose

Show self-hosted users what the enterprise features are, where they would use them, and how to get them, and measure which ones they want.

## ADDED Requirements

### Requirement: Locked enterprise screens
On a self-hosted instance whose plan lacks a feature, the Access and security tab (`organization`: access controls, domain verification, SSO) and the Audit log tab (`auditLog`) SHALL appear in settings, on the OSS and EE images, and each section whose `Flag` is off SHALL show a locked state instead of being hidden. The locked state SHALL say in one or two sentences what the feature does, in words for users who are not technical, and SHALL show the actions that apply (next requirement).

#### Scenario: OSS instance opens Audit log
- **WHEN** a user on an OSS instance opens Audit log
- **THEN** they SHALL see what audit logs are and the actions that apply, and SHALL NOT see an error

#### Scenario: Feature included in the plan
- **WHEN** the plan includes the feature
- **THEN** the screen SHALL work as today

### Requirement: Locked state actions
The locked state SHALL show only the actions that apply: "Get a free key" (`get_free_key`) when `self_hosted_registered` has the flag and the instance has no key, which no flag does at first; "Add a license key" (`add_license_key`) on the EE image, which opens the License page; "How to upgrade" (`upgrade_docs`) on the OSS image, which opens the self-host upgrade docs; and "Talk to us" (`talk_to_us`), which opens Agenta's contact page with the feature in the link.

#### Scenario: EE instance without a key
- **WHEN** a user on an EE instance with no key opens Access and security
- **THEN** the locked sections SHALL show "Add a license key" and "Talk to us"

### Requirement: Upgrade events
Each time a locked state is shown, and each time one of its actions is clicked, the browser SHALL send `upgrade_prompt_viewed` or `upgrade_prompt_clicked`, when telemetry is on. Both SHALL carry `feature` (the `Flag` value: `access`, `audit`, `domains` or `sso`) and `screen` (the settings tab key). `upgrade_prompt_clicked` SHALL also carry `action` (the action value above).

#### Scenario: Measuring demand
- **WHEN** we look at the last 30 days in PostHog
- **THEN** we SHALL be able to rank enterprise features by views and clicks across instances

### Requirement: Offer after the setup survey
On a self-hosted instance with no key, when an instance admin finishes or skips the setup survey, Agenta SHALL show one offer: register the instance with their email, filled in, for product updates and the free features we add later. It SHALL NOT name features that registering does not unlock yet. When the survey's company size answer is 51 or more, it SHALL also show "Talk to us about Enterprise". The offer SHALL have a visible "Skip".

#### Scenario: Small team
- **WHEN** the instance admin picks "2-10" and finishes the survey
- **THEN** the registration offer SHALL appear, without the Enterprise line

#### Scenario: Larger company
- **WHEN** the instance admin picks "201+"
- **THEN** the offer SHALL also show "Talk to us about Enterprise"

#### Scenario: Skip
- **WHEN** the instance admin clicks Skip
- **THEN** the offer SHALL close; it is part of the setup flow, which runs once per user, so it SHALL NOT appear again
