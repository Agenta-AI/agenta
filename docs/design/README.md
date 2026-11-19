# Design docs

Each folder here holds the design, plan or research for one piece of work, written when that work
was done. The docs are a dated record: they are not updated when the code changes later.

Many of them name `web/oss` and `web/ee`, the desktop web app that was removed in favor of
`web/mobile` (served at `/m`). Those paths are history. The desktop app no longer exists, so read
them as "the old desktop app" and look for the live code in `web/mobile` and `web/packages`.

`docs/design/testing/` is the exception: it describes how tests run today and is kept current.
`scripts/check-no-desktop-app-refs.sh` enforces that split in CI.
