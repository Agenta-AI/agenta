# Template subagents

## Why

Some future templates will need several agents that call one another. Recording their requirements now preserves the intended direction without adding that complexity to the first single-agent loader.

## What Changes

This is a deferred proposal, NOT IMPLEMENTED. It would permit multiple agent definitions and references between them. A general capability to create and edit other agents would let the entry agent configure its children through ordinary tools. It would not introduce template-specific setup tools.

## Capabilities

### New Capabilities

- `template-subagents`: Future agent definitions, calling-tool descriptions, shared children, and bounded calls.

### Modified Capabilities

None at this stage. The first-version rejection of multi-agent packages must be explicitly revised when this proposal is approved for implementation.

## Impact

Future agent-management tools, authorization, reference-tool configuration, and execution guards. None are first-version release criteria. Validation reports must say NOT IMPLEMENTED until implemented and exercised.
