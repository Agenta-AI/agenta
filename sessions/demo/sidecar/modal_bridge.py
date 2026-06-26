"""Modal provider bridge, called by provider-modal.js as a subprocess.

Modal has no Node SDK, so the Node sidecar shells out to this. Commands (argv[1]):
  up    --sid S --endpoint URL [--sandbox-id ID] [--anthropic K] [--openai K]
        provision-or-reconnect a Modal sandbox, mount geesefs(<sid>) from the tunnel,
        start sandbox-agent on :2468 (exposed via an encrypted tunnel), print JSON
        {"sandbox_id","base_url","cwd"} on the LAST stdout line.
  kill  --sandbox-id ID    terminate the sandbox (cwd stays durable in S3).

Auth: reads ~/.modal.toml (modal token new) or MODAL_TOKEN_ID/SECRET from env.
The image (sandbox-agent + claude + codex + geesefs) is baked once and cached by Modal.
"""

import argparse
import json
import sys
import time

import modal

AGENT_PORT = 2468
APP_NAME = "rivet-demo-modal"
GEESEFS = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# Image: sandbox-agent + claude + codex + geesefs, baked once and content-cached by Modal.
# fuse + ca-certificates for geesefs/TLS; node for sandbox-agent install.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "fuse", "ca-certificates", "git", "procps")
    .run_commands(
        # node 22 (sandbox-agent installer expects a recent node)
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        # rivet sandbox-agent
        "curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh",
        "cp $(find / -name sandbox-agent -type f 2>/dev/null | head -1) /usr/local/bin/sandbox-agent || true",
        "sandbox-agent --version",
        # agents (cloud image is real x64 -> install-agent's x64 binaries are correct)
        "sandbox-agent install-agent claude",
        "sandbox-agent install-agent codex",
        # opencode: install-agent (fail-soft on its verify crash), then ensure the x64
        # native binary is in place at both launcher locations. On real-x64 cloud the
        # default download is already correct; we just guard the verify step.
        "sandbox-agent install-agent opencode || echo 'opencode verify failed (continuing)'",
        "/root/.local/share/sandbox-agent/bin/opencode --version || echo 'opencode binary check skipped'",
        # pi: install-agent gives only the pi-acp adapter; the real CLI is a separate npm pkg.
        "sandbox-agent install-agent pi || echo 'pi install-agent non-zero (continuing)'",
        "npm install -g @earendil-works/pi-coding-agent@0.80.2",
        # geesefs
        f"curl -fsSL -o /usr/local/bin/geesefs {GEESEFS} && chmod +x /usr/local/bin/geesefs",
        "echo user_allow_other >> /etc/fuse.conf",
    )
)


def _app():
    return modal.App.lookup(APP_NAME, create_if_missing=True)


def _exec(sb, script, timeout=120):
    # read the pipes BEFORE wait(): a command with large stdout (e.g. cat /tmp/sa.log)
    # can fill the bounded pipe buffer and deadlock if we wait() first.
    p = sb.exec("bash", "-c", script, timeout=timeout)
    out, err = p.stdout.read(), p.stderr.read()
    p.wait()
    return p.returncode, out, err


def up(args):
    app = _app()
    sb = None
    if args.sandbox_id:
        try:
            sb = modal.Sandbox.from_id(args.sandbox_id)
            # poke it; from_id on a dead sandbox raises on first use
            sb.exec("bash", "-c", "true").wait()
            log(f"reconnected to {args.sandbox_id}")
        except Exception as e:
            log(f"reconnect failed ({e}); creating fresh")
            sb = None

    if sb is None:
        sb = modal.Sandbox.create(
            "sleep",
            "infinity",
            app=app,
            image=image,
            timeout=3600,
            encrypted_ports=[AGENT_PORT],
            experimental_options={"vm_runtime": True},  # required for /dev/fuse
        )
        log(f"created sandbox {sb.object_id}")

    cwd = "/root/work"
    # codex auth.json (the ACP adapter authenticates from this file, not just env)
    if args.openai:
        _exec(
            sb,
            f"mkdir -p /root/.codex && printf '{{\"OPENAI_API_KEY\":\"%s\"}}' '{args.openai}' > /root/.codex/auth.json",
        )
    # pi: trust projects so non-interactive RPC sessions don't block on a trust prompt
    _exec(
        sb,
        'mkdir -p /root/.config/pi && printf \'{"defaultProjectTrust":"trusted"}\' > /root/.config/pi/settings.json',
    )

    # mount geesefs if not already healthily mounted. A stale FUSE endpoint reports as a
    # mountpoint but errors with "Transport endpoint is not connected" — treat as unmounted.
    rc, out, _ = _exec(
        sb, f"ls {cwd} >/dev/null 2>&1 && mountpoint -q {cwd} && echo yes || echo no"
    )
    if "yes" not in out:
        _exec(sb, f"fusermount -u {cwd} 2>/dev/null; umount -l {cwd} 2>/dev/null; true")
        rc, out, err = _exec(
            sb,
            f"mkdir -p {cwd} && AWS_ACCESS_KEY_ID={args.s3_key} AWS_SECRET_ACCESS_KEY={args.s3_secret} "
            f"geesefs --endpoint {args.endpoint} --region us-east-1 --no-detect --fsync-on-close "
            f"-o allow_other {args.bucket}:{args.sid} {cwd} && echo MOUNT_OK",
            timeout=90,
        )
        if "MOUNT_OK" not in out:
            raise RuntimeError(f"geesefs mount failed: {err or out}")

    # start sandbox-agent server in the background if not already serving
    rc, out, _ = _exec(
        sb,
        f"curl -sf http://localhost:{AGENT_PORT}/v1/health >/dev/null && echo up || echo down",
    )
    if "up" not in out:
        env_exports = ""
        if args.anthropic:
            env_exports += f"ANTHROPIC_API_KEY='{args.anthropic}' "
        if args.openai:
            env_exports += f"OPENAI_API_KEY='{args.openai}' "
        # detached; nohup so it outlives this exec
        sb.exec(
            "bash",
            "-c",
            f"{env_exports} nohup sandbox-agent server --no-token --host 0.0.0.0 --port {AGENT_PORT} "
            f">/tmp/sa.log 2>&1 &",
        )
        # poll health
        for _ in range(40):
            rc, out, _ = _exec(
                sb,
                f"curl -sf http://localhost:{AGENT_PORT}/v1/health >/dev/null && echo up || echo down",
            )
            if "up" in out:
                break
            time.sleep(1)
        else:
            _, log_out, _ = _exec(sb, "cat /tmp/sa.log")
            raise RuntimeError(f"sandbox-agent did not come up: {log_out}")

    base_url = sb.tunnels()[AGENT_PORT].url
    print(
        json.dumps({"sandbox_id": sb.object_id, "base_url": base_url, "cwd": cwd}),
        flush=True,
    )


def kill(args):
    sb = modal.Sandbox.from_id(args.sandbox_id)
    sb.terminate()
    print(json.dumps({"killed": args.sandbox_id}), flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("up")
    u.add_argument("--sid", required=True)
    u.add_argument("--endpoint", required=True)
    u.add_argument("--sandbox-id", dest="sandbox_id", default=None)
    u.add_argument("--anthropic", default=None)
    u.add_argument("--openai", default=None)
    u.add_argument("--s3-key", dest="s3_key", default="demo")
    u.add_argument("--s3-secret", dest="s3_secret", default="demosecret")
    u.add_argument("--bucket", default="demo")
    u.set_defaults(fn=up)
    k = sub.add_parser("kill")
    k.add_argument("--sandbox-id", dest="sandbox_id", required=True)
    k.set_defaults(fn=kill)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
