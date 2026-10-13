## ADDED Requirements

### Requirement: Independent checkout
Eligible lifetime customers SHALL be able to buy configured credit packages through one-time payment checkout without creating or changing a recurring subscription or platform entitlement.

#### Scenario: Lifetime top-up
- **WHEN** a lifetime customer with no active Stripe subscription completes a valid credit purchase
- **THEN** the purchased lot is granted after verified payment and lifetime access remains unchanged

#### Scenario: Unpaid checkout
- **WHEN** checkout is abandoned or the payment is unsuccessful
- **THEN** no purchased value is issued

### Requirement: Replay-safe grants
Funding issuance SHALL verify payment events server-side and deduplicate the economic grant identity across retries and multiple event types.

#### Scenario: Duplicate notifications
- **WHEN** multiple verified notifications refer to the same purchase
- **THEN** only one credit grant is issued

#### Scenario: Renewal
- **WHEN** an eligible subscription payment renews the allowance
- **THEN** a distinct allowance lot is issued once without resetting purchased funds

### Requirement: Configurable offer terms
Configuration SHALL separately define entitlements, included resource quantities, optional general credits, package grants, expiry and overage availability without requiring final numeric choices in code.

#### Scenario: Free offer
- **WHEN** a configured free plan includes sandbox usage and optionally a promotional credit grant
- **THEN** each benefit is applied independently; zero wallet credit does not remove included sandbox access

#### Scenario: Lifetime monthly reset
- **WHEN** a lifetime usage period changes without a Stripe renewal
- **THEN** included resource counters reset under the configured period while purchased credit remains intact

### Requirement: Refund and sold-term protection
The funding system SHALL retain sold offer/package versions and record authorized refund or dispute adjustments without deleting history.

#### Scenario: Changed package
- **WHEN** an operator changes future package value
- **THEN** a prior verified purchase receives the value of its purchased version

#### Scenario: Refund
- **WHEN** a payment is reversed after some credit was spent
- **THEN** the configured recoverable adjustment policy applies once and records any remaining exposure
