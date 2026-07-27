# Pre-production breaking reset

There is no backward compatibility work.

- Do not decode the old flat object.
- Do not migrate it during invocation.
- Do not dual write.
- Do not add a feature flag.
- Do not preserve public stdio as an unsupported variant.

Existing development revisions containing the old MCP object are invalid after this change. Users
must remove and recreate those entries in the new editor. A malformed entry fails validation
before the runner starts, so development does not degrade into a confusing agent-wide runtime
failure.

The private trusted Daytona stdio shim is a different internal type and remains unchanged.

Rollback means reverting the code while still in pre-production. It does not justify permanent
schema or runtime compatibility branches.
