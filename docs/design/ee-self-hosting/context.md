# Context & Motivation

## Background

Agenta's Enterprise Edition (EE) was built primarily for the cloud offering. As a result, EE code conflates two distinct concerns:

1. **Enterprise features** — RBAC, organization management, entitlements, workspace controls
2. **Cloud/SaaS features** — Billing (Stripe), subscriptions, reverse trials, usage metering

A customer wants to self-host Agenta with enterprise capabilities but without cloud billing infrastructure.

## Problem Statement

The current EE cannot be deployed in a self-hosted context without carrying along billing and cloud-specific code. Additionally, several capabilities required for self-hosted enterprise deployments are missing entirely:

- **Entitlement configuration** — No way to specify entitlements per organization without Stripe/billing
- **Default entitlements** — No concept of a default entitlement set for new orgs
- **Organization creation control** — No mechanism to control who can create organizations
- **Admin user bootstrapping** — No way to designate the initial admin user
- **Organization initialization** — No lifecycle for bootstrapping orgs in a self-hosted environment

## Goals

- Self-hosted enterprise customers get RBAC, entitlements, and org management without billing dependencies
- Clear separation between enterprise features and cloud/SaaS features
- Entitlements can be configured without a billing provider
- Admin and org bootstrapping works for self-hosted deployments

## Non-Goals

- Removing or rewriting the cloud billing system (it continues to work as-is for cloud)
- Building a full admin UI for self-hosted management (CLI/config-based is fine initially)

## Open Questions

- What is the exact entitlement model needed for self-hosted? (subset of cloud tiers?)
- How should the admin user be bootstrapped? (env var, first-user-is-admin, CLI command?)
- Should organizations be pre-created or created on-demand?
- What is the deployment topology for self-hosted EE? (single-tenant? multi-tenant?)
