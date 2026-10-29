# Test plan

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Runner tests

- Reject a request with no runner token.
- Reject a request with an incorrect runner token.
- Return `not_configured` when the harness environment variable is not set.
- Return `login_missing` when the folder exists but the expected file does not exist.
- Return `login_unusable` when the file is empty, unreadable, or invalid.
- Return `ready` when the file has the minimum valid shape.
- Confirm that the JSON response has no path, token, account, email, or raw error.
- Confirm that one harness check cannot stop the checks for other harnesses.

Use temporary folders and fake tokens. Do not read a developer's real login folder.

## Server tests

- Map a valid runner response to `runner: connected`.
- Map connection refusal and timeout to `runner: unavailable`.
- Map runner HTTP 404 to `runner: incompatible`.
- Reject an invalid runner response.
- Confirm that the public response has no runner token or local path.
- Confirm that an unauthenticated Agenta user cannot call the public route.
- Reject an arbitrary runner URL in the public request.
- Confirm that the status request and a model run resolve the same runner connection.

## Frontend tests

- Do not fetch status while the user selects **API key**.
- Fetch status when the user selects **Subscription**.
- Select the state for the current harness.
- Show all messages defined in `api-design.md`.
- Refetch when the user selects **Check again**.
- Show unknown or incompatible status for an old runner.
- Do not store the response in browser persistent storage.
- Keep the setup guide link visible for all failure states.

## Manual test

1. Start Agenta without a subscription mount. Select **Subscription**. Confirm that the card shows
   `Subscription folder is not configured.`
2. Start the runner with an empty mounted folder. Confirm that the card shows `Login file is missing.`
3. Add a fake invalid login file. Confirm that the card shows `Login file cannot be used.`
4. Sign in with the harness on the host. Select **Check again**. Confirm that the card shows
   `Subscription login found.`
5. Stop the runner. Confirm that the card changes to `Runner is not connected.`
6. Start an older runner without the new endpoint. Confirm that the card asks the user to update the
   runner.
7. Start one real low-cost model run. Confirm that the run succeeds. This step verifies provider
   access. The status endpoint does not verify provider access.
