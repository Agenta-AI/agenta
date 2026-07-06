---
id: op-renames
title: Rename find_capabilities/find_triggers to discover_tools/discover_triggers?
status: locked
task: ''
pr: ''
recommendation: '(a): aliases cost a dict entry and break nothing.'
answer: let's hard migrate. As I always keep telling you, we are still pre-production
  we dont give a shit about backward compatibility. Let's add this to the decision
  list, since later we are going ot push many in one pr
answered_by: user
raised: '2026-07-03T13:56:09Z'
updated: '2026-07-04T17:50:15Z'
---




# Rename find_capabilities/find_triggers to discover_tools/discover_triggers?

## Context

The op key is the config contract ({type: platform, op: ...}). Renaming aligns inside names with the outside scripts (discover-tools.sh / discover-triggers.sh) and the endpoint verb (/api/tools/discover). Existing committed configs may reference the old keys.

## Options

- (a) rename + keep old keys as aliases in get_platform_op (my rec)
- (b) hard migrate
- (c) keep old names

## Recommendation

(a): aliases cost a dict entry and break nothing.

## Your decision

**Locked:** let's hard migrate. As I always keep telling you, we are still pre-production we dont give a shit about backward compatibility. Let's add this to the decision list, since later we are going ot push many in one pr

Already locked earlier; no-op if this errors.

_2026-07-04T17:50:15Z_
