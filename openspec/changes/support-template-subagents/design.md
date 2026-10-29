# Deferred multi-agent design

## Context

The first version loads one agent. This proposal is NOT IMPLEMENTED and must not expand its release boundary.

## Goals / Non-Goals

Keep a flat agent map with optional references. Use a general ability to create/edit other agents when that capability is designed. Do not implement graph installation, new agent tools, or recursion changes in PR #6944.

## Decisions

Agent descriptions belong to the target definition. A reference's optional `tool_description` explains when to call it. Permission and input schema are optional and fall back to existing native defaults.

Create identities before links. Any projection uses visited agent keys, so shared children and mutual links terminate. A synchronous call chain starts with the entry identity before dispatching children. These requirements address future graph behavior only.

## Risks / Trade-offs

General cross-agent editing needs a separate authorization design. Its API and tool shape are not specified by the first-version work. This proposal cannot be implemented or marked validated until that dependency is designed and approved.
