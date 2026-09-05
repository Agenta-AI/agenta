# Custom-secret browser evidence

Tested on the local application at port 8980 with a disposable workflow and a separate Playwright browser context. The fixture used the fixed value `QA_PLACEHOLDER_NOT_A_REAL_CREDENTIAL`. Browser logs and screenshots excluded request bodies and secret content.

## Requested setup and runtime verification

The real desktop conversation called `request_secret`, proposed `DEPLOY_TOKEN`, and opened the shared form with that default directly below Value. Cancelling the setup and selecting Not now settled once; the agent did not repeat the request. On explicit retry, creating and attaching the approved dummy saved revision v1 and adopted it before the resume request. The same session continued, approved a Python command, and wrote a SHA-256 file whose content matched the dummy value. Browser run requests contained references rather than the dummy value.

See [reference-only wire evidence](assets/browser-resume-evidence.json), [request form](assets/request-create-demo.png), and [resumed conversation](assets/resume-demo.png). The happy-path vault-response counter did not observe the canonical endpoint and is excluded from the evidence.

## Advanced checks passed

- The Advanced drawer shows one **Custom secrets** heading after the duplicate inner heading was removed.
- Create shows **Default environment variable** directly below **Value**.
- A saved default of `QA_DEFAULT_TOKEN` becomes the initial attachment name.
- Changing the attachment name to `QA_ATTACHMENT_TOKEN` commits the override without changing the saved default metadata.
- Create and attach issued one vault create and one revision commit.
- The host adopted the attached revision, changed the displayed variant from v0 to v1, and closed Advanced.
- Refresh showed one persisted attachment with its environment name and vault display name. No secret content appeared.
- Editing the binding to `QA_EDITED_TOKEN` issued one revision commit, adopted v2, and closed Advanced.
- Removal stated that the secret stays in the project vault, issued one revision commit, adopted v3, closed Advanced, and returned to the empty state.

The screenshot at [assets/advanced-demo.png](assets/advanced-demo.png) shows the persisted attachment before removal and contains no secret content.

## Partial-save recovery passed

A real Advanced create/attach flow saved one fixed dummy vault entry, intercepted the first revision commit with HTTP 409, retained the selected saved secret, and succeeded on retry. The browser observed one vault create and two commit requests. The host adopted v4 and closed Advanced after the successful retry.

## Advanced dirty and removal recovery passed

Changing the local Advanced policy without saving showed save/discard guidance and disabled Attach, Edit, and Remove. No revision commit occurred. Reload discarded that temporary draft. An injected HTTP 409 during attachment removal kept the confirmation open with an inline error; retry succeeded, adopted v5, and retained the vault entry. See [recovery evidence](assets/advanced-recovery-evidence.json).

## Failed-resume recovery passed

An injected HTTP 503 after Continue left the saved attachment intact. The error callout survived transcript hydration and offered Try again. The existing retry confirmation restarted the turn using the same revision and session. Because this fixture explicitly instructed the model to request the secret again, it repeated the card; Continue reused the saved binding and the agent answered “Recovery complete.” Across failure, retry, and continuation, the browser observed zero vault creates and zero revision commits. See [request evidence](assets/retry-evidence.json) and [real-app capture](assets/retry-demo.png).

The application currently renders overlapping copies of its global confirmation dialog. QA clicked the topmost visible button with ordinary pointer input; ARIA-role selectors could not address that copy. This existing confirmation-renderer issue is separate from credential setup.

## Cleanup

Both Advanced QA attachments were removed from the disposable variant. The vault test entries remain, including `qa-advanced-knog6u`; the separate request-flow fixture retains its dummy attachment for review. Automatic approval review rejected deletion of the identified Advanced vault entry. No real credentials were used.
