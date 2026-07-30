# Current Problem And Scope

## Current user experience

A Railway API failure can prevent bootstrap from creating one required service.
The previous bootstrap script hid the failed `railway add` command and still
printed `Bootstrap completed`. The later deploy then fails when configure tries
to set variables on the missing service.

Re-running only failed deploy jobs does not repair the environment. Bootstrap
already succeeded, so those jobs do not create the missing service. The user
must re-run all jobs or push another commit.

## Goal

Bootstrap must report success only after Railway lists all 13 services required
by an OSS preview. When a service remains absent, the setup job must fail with
the missing names. Configure must tell the user to re-run all jobs when it
detects the same condition.

## Out Of Scope

- Retrying every Railway command globally.
- Repairing missing services from the deploy job.
- Changing service names, images, volumes, or the preview workflow's public
  inputs.

## Constraints

`railway add` may fail after Railway has accepted the request. The fix cannot
blindly retry that command because a second request could create a duplicate
service. The scripts must continue to support the current Railway CLI calls
and Bash execution environment.
