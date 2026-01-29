# Context: Agents Feature

## Background

Agenta currently supports prompt engineering and evaluation workflows for LLM applications. The next evolution is enabling **agent capabilities** - allowing users to create AI agents that can use tools, make decisions, and perform multi-step tasks.

## Problem Statement

Users want to build agent-based applications but:
1. There's no native support for tools/function calling in the playground
2. No way to define, manage, or test agent workflows in the UI
3. Missing integration with external tool providers
4. No standardized way to create agents within the Agenta ecosystem

## Goals

- [ ] Define clear scope for agent feature MVP
- [ ] Research tool integration options (Composio, native, others)
- [ ] Understand playground requirements for tool support
- [ ] Evaluate minimal agent frameworks
- [ ] Create actionable PRD

## Non-Goals (Initial Phase)

- Full autonomous agent orchestration (v1 is simpler)
- Complex multi-agent systems
- Custom tool development IDE
- Agent-to-agent communication

## Key Questions to Answer

1. **Scope**: What is the minimum viable agent feature?
2. **Tools**: How do we integrate tools? Build vs. buy?
3. **Playground**: How does tool calling work in completion/chat modes?
4. **Framework**: Do we need an agent framework? Which one?

## Success Criteria

- Clear PRD with user stories
- Technology decisions documented
- Architecture proposal ready
- Scope agreed upon
