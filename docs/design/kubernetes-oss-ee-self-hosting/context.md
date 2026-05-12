# Context

## Problem

Agenta already has:

- a Docker Compose deployment path for OSS and EE
- a Kubernetes Helm chart and guide for OSS

But the Kubernetes path is currently OSS-specific and behind the current runtime topology. We want a clean self-hosting story on Kubernetes for both OSS and EE.

## Goals

- Keep Docker Compose deployments untouched
- Support a clean Kubernetes path for OSS and EE
- Avoid hacky per-install overrides for users
- Keep one clear user-facing setup flow
- Test changes locally before documenting them
- Split the work into focused PRs

## Non-goals

- Replacing Docker Compose
- Doing a one-off manual EE-only Kubernetes workaround as the final solution
- Creating two permanently divergent Helm charts unless absolutely necessary

## Constraints

- Do not break ongoing Docker Compose deployments
- Use isolated Kubernetes namespaces/releases for testing
- Use different local forwarded ports if port-forwarding is needed
- EE image access may require GHCR auth or local image import

## User-facing direction

The desired end state is a unified Kubernetes chart flow that supports both OSS and EE using `AGENTA_LICENSE`, with curated example values files for each mode.
