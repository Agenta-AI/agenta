# Third-party notices

This bundle contains third-party software. The build copies available license texts into
`licenses/` and preserves Python package license files in each installed `.dist-info`
directory. `manifest.json` records the exact runtime sources, lockfile hashes, and target
platform (`target_platform`, `target_arch`, `min_libc`) for the platform this bundle was
built for.

## CPython runtime

- CPython 3.13.15 from the python-build-standalone 20260814 release, pinned per target
  platform; the exact archive, URL, and SHA256 are recorded in `manifest.json`
  (`python.archive`, `python.url`, `python.sha256`)
- Source: https://github.com/astral-sh/python-build-standalone
- License: Python Software Foundation License 2.0 and the component licenses shipped in
  the distribution

python-build-standalone is distributed under the Mozilla Public License 2.0. Its output
contains CPython and libraries under their own licenses. License texts present in the pinned
distribution, including CPython and pip's vendored components, are copied to
`licenses/python-runtime/`.

## Node.js runtime

- Node.js v24.19.0 for the target platform; the exact distribution URL and SHA256 are
  recorded in the embedded runner stage manifest (`runner_stage.manifest.node`)
- Source: https://nodejs.org/dist/v24.19.0/
- License: MIT and bundled component licenses

The verified Slice 1 runner stage supplies Node.js, the runner dependency tree, its lockfile,
and its license material. The final manifest embeds that stage's manifest and checksum.

## Runner native packages

The runner dependency tree includes OS-specific native binaries selected by the platform
the stage was installed on (for example `@sandbox-agent/cli-linux-x64` or
`@sandbox-agent/cli-darwin-arm64`, plus the matching `@esbuild/<os>-<arch>` package).
License material for those packages ships under `licenses/runner/`.

## Python packages

Python dependencies are exported with hashes from `services/local/uv.lock`. The build
appends the installed package names, versions, and declared licenses below this section and
copies available package license files to `licenses/python-packages/`.
