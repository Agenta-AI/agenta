# WP38 tasks — Project-key Composio standard MCP

- [ ] Define the endpoint path, project-owned Composio key representation, connection ownership,
      and callback contract independently from builtin Composio.
- [ ] Implement standard endpoint selection and strict project-key resolution with **unit tests**
      proving no deployment-key fallback.
- [ ] Implement the project-key Composio connection and MCP adapter path with **integration tests**
      for isolation, missing keys, and disconnected accounts.
- [ ] Add a local broker double and **OSS/EE acceptance** covering `tools/list`, `tools/call`, and
      the negative fallback case.
- [ ] Verify runner and agent inputs contain only the Agenta gateway URL and short-lived gateway
      credential, never either Composio developer key or an external-account credential.
