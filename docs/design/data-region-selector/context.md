# Context: Data Region Selector

## Background

Agenta Cloud is expanding from a single deployment to a multi-region architecture:
- **EU Region**: `eu.cloud.agenta.ai` - Data stored in European data centers
- **US Region**: `us.cloud.agenta.ai` - Data stored in US data centers

This change is driven by:
1. **Data residency compliance** - GDPR, SOC2, and enterprise requirements
2. **Performance** - Lower latency for users closer to their region
3. **Customer demand** - Enterprise customers often require specific data locations

## Problem Statement

Users visiting `cloud.agenta.ai` need to:
1. Understand that different data regions exist
2. Choose the appropriate region for their needs
3. Be directed to the correct regional instance

Additionally, users who land directly on a regional domain should:
1. Know which region they're currently in
2. Be able to switch regions if needed

## Goals

1. **Clear region indication** - Users always know which region they're using
2. **Easy region selection** - Simple UX for choosing a region on sign-up
3. **Discoverable switching** - Users can find how to switch regions
4. **Informative** - Users understand the implications of their choice
5. **Minimal friction** - Don't add unnecessary steps to the auth flow

## Non-Goals

1. **Cross-region data sync** - Each region is completely independent
2. **Account migration** - Users cannot migrate between regions (v1)
3. **Region auto-detection** - No IP-based geolocation (privacy concerns)
4. **SSO spanning regions** - Each region has its own auth system

## Constraints

- Each regional instance is a completely separate deployment
- Sessions are not shared between regions
- User accounts exist independently per region
- The same email can have different accounts in different regions
- We cannot read data from one region while on another

## Success Metrics

- Users successfully land in their intended region
- Reduced support tickets about "wrong region" or "can't find my data"
- Clear understanding demonstrated through user research
