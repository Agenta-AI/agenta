# View Improvements

**Status:** Research  
**Priority:** High (identified as biggest quality-of-life issue during dogfooding)  
**Sprint:** Q1 2026

## Overview

Consolidate and improve how data values (JSON, chat messages, text, inputs/outputs) are displayed across all surfaces in Agenta. Currently, the same data is rendered inconsistently across different surfaces, with some areas (especially observability) providing poor readability that makes the product "feel unusable" despite being technically functional.

## Problem Statement

From internal dogfooding and customer feedback: **"The readability, especially in traces, is unreadable. It makes the experience very, very bad."**

The core issues:
1. Chat messages appear as raw JSON strings instead of structured role-based display
2. No view mode switching (JSON/rendered/text/markdown) in many surfaces
3. Inconsistent rendering between surfaces (eval table vs observability table vs playground)
4. Missing copy functionality in key places
5. No "rendered table view" for JSON (Braintrust reference)

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, goals, non-goals |
| [research.md](./research.md) | Codebase analysis, component inventory, gaps identified |
| [competitive-analysis.md](./competitive-analysis.md) | How competitors solve these problems |
| [chat-extraction-algorithm.md](./chat-extraction-algorithm.md) | Shared chat detection logic, preference model, and edge cases |
| [plan.md](./plan.md) | Execution plan with phases |
| [status.md](./status.md) | Current progress and decisions |

## Scope Summary

### In Scope
- Observability table cell rendering (inputs/outputs/tooltips)
- Span detail view improvements
- Playground output view switcher
- Testset view rendering
- Component consolidation where beneficial

### Out of Scope (for this iteration)
- SDK-side changes (parameters in inputs issue)
- New evaluator features
- Playground comparison mode improvements (separate track)

## Quick Links

- **Transcript Reference:** Sprint Planning Feb 10, 2026
- **Key Surfaces:** Observability table, Trace drawer, Playground outputs, Testset table
- **Main Gap:** `TruncatedTooltipTag` → `SmartCellContent` migration in observability
