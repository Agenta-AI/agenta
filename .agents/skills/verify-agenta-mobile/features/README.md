# Agenta app verification map

This directory is the maintained source for verifying user-facing behavior in `web/mobile`. Read the index first, then use the feature file as the recipe.

## Baseline preconditions

- `scripts/doctor.sh` exits `0` and reports no membership 401s.
- Chrome is signed in, and the URL names a project that user belongs to.
- A test agent with two sessions comes from `scripts/pick-fixture.sh`.
- The page has rendered and `scripts/page-helpers.js` is loaded.

## Driving conventions

- Switch sessions with `__v.go`, a client-side route change. A reload clears the pins, which hides revision bugs.
- Leave a session only after `__v.words()` returns a number.
- Restore the agent's config after a run that commits.

## Proof and skip reporting

- Record the feature, the entry point, and the before and after values.
- Name what was simulated.
- Report a path you could not reach, with what you tried.

## Features

- [Session version update](session-version-update.md)
- [Session switching](session-switching.md)
