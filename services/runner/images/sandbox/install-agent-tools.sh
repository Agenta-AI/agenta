#!/bin/sh
# Shared install recipe for the agent sandbox: the tools an agent can call, with one pin per tool.
#
# Runs as root at image build time on Debian bookworm, amd64 or arm64, in all three images that
# form a sandbox: the production runner (docker/Dockerfile.gh, the local sandbox), the dev
# runner (docker/Dockerfile.dev), and the Daytona snapshot (images/sandbox/daytona/
# build_snapshot.py, which embeds this file base64 because the Daytona build has no context).
# One file, so the local and the Daytona sandboxes cannot drift on what an agent finds on PATH.
#
# Every section ends with a check that fails the build when the pin is wrong or the install did
# not take. A tool that is quietly missing costs the agent failed shell calls and the person
# approval prompts, so the build is where it must fail.
#
# What is NOT here, on purpose: the image-specific bits (fuse.conf, libnss-unknown, geesefs) stay
# in the Dockerfiles; the harness pins (pi, codex-acp) stay in their own steps.
set -eu

# ---- pins ------------------------------------------------------------------------------------
GH_VERSION="2.100.0"
UV_VERSION="0.12.10"
FD_VERSION="v10.4.2"
PLAYWRIGHT_VERSION="1.62.0"      # node CLI and python package share this minor: one browser build
TYPESCRIPT_VERSION="5.9.3"       # 5.x: ts-node needs the JS compiler API; typescript 7 is the Go rewrite
TS_NODE_VERSION="10.9.2"
PRETTIER_VERSION="3.9.6"
ESLINT_VERSION="10.10.0"
BUN_VERSION="1.4.2"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"

export DEBIAN_FRONTEND=noninteractive
arch="$(dpkg --print-architecture)"
# Release tarballs are pinned by sha256 per architecture, so a moved tag or a tampered download
# fails the build. Refresh the sums when the pin changes: the uv release publishes
# `<asset>.sha256`; for fd, download and `sha256sum` the tarball.
case "$arch" in
  amd64)
    fdarch="x86_64-unknown-linux-musl"
    fdsha="e3257d48e29a6be965187dbd24ce9af564e0fe67b3e73c9bdcd180f4ec11bdde"
    uvarch="x86_64-unknown-linux-gnu"
    uvsha="173d95a0c32d18c896c46ba6fafbf3cf9c14ab74b033f81b76c883ef492a976b"
    bunarch="x64"
    bunsha="36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913"
    ;;
  arm64)
    fdarch="aarch64-unknown-linux-musl"
    fdsha="f32d3657473fba74e2600babc8db0b93420d51169223b7e8143b2ed55d8fd9e8"
    uvarch="aarch64-unknown-linux-gnu"
    uvsha="9ff6b9d4665edcdd3a88dcc73cd1eb641754deb927f14e8c62ebfde6bf4f5f5e"
    bunarch="aarch64"
    bunsha="54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7"
    ;;
  *) echo "unsupported arch $arch" >&2; exit 1 ;;
esac
verify_sha256() { echo "$2  $1" | sha256sum -c - >/dev/null || { echo "checksum mismatch: $1" >&2; exit 1; }; }

# ---- apt: the everyday shell tools -----------------------------------------------------------
# python3-venv: plain `python -m venv` fails on Debian without it. python-is-python3: a plain
# `python` on PATH. build-essential + pkg-config: native Python and Node packages compile on
# install. poppler-utils + tesseract: PDF text, PDF to image, OCR. ffmpeg: media, and the
# programmatic-demo style recorders that need a full system build. fonts: pages and PDFs render
# text instead of boxes.
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl wget gnupg git git-lfs openssh-client rsync \
  unzip zip file tree procps less vim-tiny nano tmux \
  netcat-openbsd dnsutils iputils-ping sqlite3 \
  build-essential pkg-config jq ripgrep \
  python3 python3-venv python3-pip python-is-python3 \
  ffmpeg poppler-utils tesseract-ocr tesseract-ocr-eng \
  fonts-liberation fonts-dejavu-core
ln -sf /usr/bin/vim.tiny /usr/local/bin/vim
for t in git git-lfs curl wget rsync unzip zip jq rg tmux sqlite3 gcc pkg-config python3 ffmpeg ffprobe pdftotext pdftoppm tesseract; do
  command -v "$t" >/dev/null || { echo "missing after apt: $t" >&2; exit 1; }
done
# Separate statements on purpose: under dash, `set -e` does not stop on a failing command that
# sits inside an `&&` list, so each check must be its own line to fail the build.
python3 -m venv /tmp/venv-check
rm -rf /tmp/venv-check
tesseract --list-langs 2>&1 | grep -q '^eng$'

# ---- gh: from GitHub's own apt repo. Debian and Ubuntu ship 2.45/2.46, which the gh
# maintainers call broken against current GitHub APIs. -----------------------------------------
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$arch signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update
apt-get install -y --no-install-recommends "gh=${GH_VERSION}*"
gh --version | grep -q "gh version ${GH_VERSION}"
rm -rf /var/lib/apt/lists/*

# ---- uv: the way an agent adds Python packages and runs scripts with dependencies. The release
# tarball, checksum-verified, instead of the piped install script. ---------------------------
curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uvarch}.tar.gz" \
  -o /tmp/uv.tar.gz
verify_sha256 /tmp/uv.tar.gz "$uvsha"
tar -xzf /tmp/uv.tar.gz -C /usr/local/bin --strip-components=1 --wildcards '*/uv' '*/uvx'
rm /tmp/uv.tar.gz
chmod +x /usr/local/bin/uv /usr/local/bin/uvx
uv --version | grep -q "uv ${UV_VERSION}"

# ---- fd: static release. Debian's fd-find is 8.6.0 on bookworm and Pi's find builtin passes
# --no-require-git, a flag fd gained in 9.0, so every Pi find call failed (52 of 52 in two
# benchmark runs) until this pin. The flag check makes a bad pin fail the build. ---------------
curl -fsSL "https://github.com/sharkdp/fd/releases/download/${FD_VERSION}/fd-${FD_VERSION}-${fdarch}.tar.gz" \
  -o /tmp/fd.tar.gz
verify_sha256 /tmp/fd.tar.gz "$fdsha"
tar -xzf /tmp/fd.tar.gz -C /usr/local/bin --strip-components=1 --wildcards '*/fd'
rm /tmp/fd.tar.gz
chmod +x /usr/local/bin/fd
fd --version | grep -q "fd ${FD_VERSION#v}"
fd --help | grep -q -- --no-require-git

# ---- node globals: formatters, the TS toolchain, and the playwright CLI -----------------------
npm install -g --no-fund --no-audit \
  "playwright@${PLAYWRIGHT_VERSION}" "typescript@${TYPESCRIPT_VERSION}" "ts-node@${TS_NODE_VERSION}" \
  "prettier@${PRETTIER_VERSION}" "eslint@${ESLINT_VERSION}"
tsc --version | grep -q "${TYPESCRIPT_VERSION}"
prettier --version | grep -q "${PRETTIER_VERSION}"

# ---- bun: the release zip, checksum-verified. Not the npm package: its binary arrives through
# an install script, which npm 11.19+ refuses for global installs by default, so the package
# "installs" with no binary and only the version check catches it. --------------------------
curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bunarch}.zip" \
  -o /tmp/bun.zip
verify_sha256 /tmp/bun.zip "$bunsha"
unzip -q -o /tmp/bun.zip -d /tmp/bun-extract
install -m 0755 "/tmp/bun-extract/bun-linux-${bunarch}/bun" /usr/local/bin/bun
ln -sf /usr/local/bin/bun /usr/local/bin/bunx
rm -rf /tmp/bun.zip /tmp/bun-extract
bun --version | grep -q "${BUN_VERSION}"
# ts-node 10 with typescript 5.9 on node 24 defaults to `module: NodeNext` when no tsconfig is in
# reach, then refuses to compile (TS5109). Agents run ts-node from a working directory with no
# tsconfig, so the images set TS_NODE_COMPILER_OPTIONS (see the Dockerfiles and the snapshot
# recipe); the check here runs under the same setting.
# Set here unconditionally (single quotes: sh takes the JSON verbatim), not via a `${X:-...}`
# default, because the `}` inside a default value ends the expansion early and corrupts the JSON.
export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}'
echo 'const v: number = 1; console.log(v)' > /tmp/v.ts
ts-node /tmp/v.ts | grep -q '^1$'
rm /tmp/v.ts
npm cache clean --force >/dev/null 2>&1 || true

# ---- one browser: Chromium, installed by Playwright, off PATH, shared by every user. ----------
# --with-deps pulls the system libraries Chromium needs. The symlink gives a plain `chromium`
# command for direct use (--headless=new --dump-dom, --screenshot). Both the node and the python
# playwright packages resolve the browser through PLAYWRIGHT_BROWSERS_PATH, so no session-time
# download ever runs.
playwright install --with-deps chromium
rm -rf /var/lib/apt/lists/*
chrome="$(find "$PLAYWRIGHT_BROWSERS_PATH" -type f -path '*chromium-*/chrome-linux*/chrome' | head -1)"
[ -x "$chrome" ] || { echo "playwright chromium binary not found under $PLAYWRIGHT_BROWSERS_PATH" >&2; exit 1; }
ln -sf "$chrome" /usr/local/bin/chromium
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"
chromium --headless=new --no-sandbox --disable-gpu --dump-dom about:blank 2>/dev/null | grep -q '<html'

# ---- python set: documents, data, the web. Resolved with `uv pip compile --generate-hashes`
# for python 3.11 (regenerate: images/sandbox/README or the PR that pinned it); the same lock
# resolves on arm64. Installed into the system interpreter so `python3` imports them with no
# venv. Everything else goes through uv at session time. -------------------------------------
# The lock lives next to this script as agent-requirements.txt (COPY'd into the runner images,
# embedded into the snapshot build alongside this file). It carries sha256 hashes for every
# wheel, so a package that does not match its hash fails the build.
req="$(dirname "$0")/agent-requirements.txt"
[ -f "$req" ] || { echo "missing $req next to $0" >&2; exit 1; }
uv pip install --system --break-system-packages --no-cache --require-hashes -r "$req"
python3 - <<'PY'
import importlib
for m in ["requests","httpx","bs4","lxml","pandas","numpy","matplotlib","PIL","scipy","sklearn",
          "statsmodels","sympy","plotly","seaborn","pyarrow","pydantic","dotenv","orjson","tabulate",
          "openai","anthropic","pytest","pypdf","docx","pptx","openpyxl","moviepy","yt_dlp",
          "flask","fastapi","uvicorn","playwright"]:
    importlib.import_module(m)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    print("python playwright chromium", b.version)
    b.close()
PY
rm -rf /root/.cache/uv /root/.cache/pip

# ---- summary the build log keeps -----------------------------------------------------------
echo "agent-tools: gh $(gh --version | head -1 | awk '{print $3}') uv $(uv --version | awk '{print $2}') fd $(fd --version | awk '{print $2}') playwright ${PLAYWRIGHT_VERSION} chromium $(chromium --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1) node $(node --version) python $(python3 --version | awk '{print $2}')"
