# Trace metrics availability delta

## Purpose

Show a hidden figure as unavailable, never as zero.

## ADDED Requirements

### Requirement: Restricted analytics are marked
Analytics responses SHALL include `access.restricted`, true when the read scope can remove data for this reader in this project. The dashboard SHALL mark restricted totals as partial.

#### Scenario: Reader with unreadable sessions
- **WHEN** Bob opens the dashboard and Alice has private sessions in the project
- **THEN** the response SHALL have `access.restricted = true` and the totals SHALL show as partial.

### Requirement: Unavailable is not zero
A cost, token or latency figure that the reader may not see, or that has no value, SHALL show as unavailable, not as 0.

#### Scenario: Denied trace
- **WHEN** a turn has no stored usage and the reader may not read its trace
- **THEN** the turn footer SHALL show cost and tokens as unavailable.

### Requirement: Access errors are not empty results
A read-scope error on an analytics request SHALL return an error status, and the dashboard SHALL show the figures as unavailable.

#### Scenario: Scope error on analytics
- **WHEN** the read scope fails during an analytics request
- **THEN** the response SHALL be an error, not an empty result.

### Requirement: Billing is unchanged
Metering, billing and usage limits SHALL NOT use the read scope.

#### Scenario: Private sessions and billing
- **WHEN** most sessions in a project are private
- **THEN** metered usage SHALL not change.
