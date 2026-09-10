# Browser release checklist

Run these checks against the real application with one editable project and one account that lacks secret-edit permission. Use a unique test secret and delete it after validation.

## Manual attachment

- Open an agent variant, expand **Advanced**, and attach an existing text secret.
- Confirm the environment suggestion uses the secret's default. Change it and confirm the override remains attachment-only.
- Save and refresh. Confirm the binding and vault display name remain visible.
- Edit the attachment, then remove it. Confirm removal keeps the vault secret and the next run no longer receives the variable.

## Requested attachment

- Start a conversation that calls `request_secret` with a unique environment name.
- Confirm the dock shows the requested name and reason. Open **Configure** and choose an existing secret.
- Repeat with **Create new**. Confirm **Default environment variable** appears directly below **Value** and begins with the requested environment name.
- Complete setup. Confirm the committed revision is adopted before the tool settles and the same conversation resumes automatically.
- Refresh after settlement. Confirm no pending card returns and no duplicate binding is created.

## Recovery

- Change an Advanced policy without saving. Confirm Attach, Edit, and Remove disable with save/discard guidance and no revision is committed. Discard the draft and confirm the actions return.
- Force attachment removal to fail. Confirm the dialog stays open with an error and retry succeeds without deleting the vault entry.

- Cancel before saving. Confirm no vault secret or binding is created and the tool settles as cancelled.
- Force attachment commit to fail after vault creation. Retry and confirm the saved slug is reused without another vault create.
- Force resume to fail after a successful attachment. Confirm the error callout survives a transcript refresh. Retry the conversation and confirm it uses the adopted revision without recreating the secret; if the turn requests setup again, Continue reuses the saved binding.
- Change the agent revision while the drawer is open. Confirm the conflict is visible and retry does not overwrite unrelated configuration.

## Permissions

- With secret-edit and agent-edit permission, confirm create, attach, edit, and remove are enabled on desktop and mobile.
- Remove secret-edit permission. Confirm Advanced attachments are read-only and the request card cannot open configuration.
- Remove agent-edit permission while retaining secret-edit. Confirm vault access does not permit a variant write.
- During capability loading or a permission-check failure, confirm both hosts fail closed.
