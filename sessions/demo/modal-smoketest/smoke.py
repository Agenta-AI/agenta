"""Modal GATE test: does geesefs FUSE work in a Modal VM-runtime sandbox, and does a
write round-trip to SeaweedFS over the ngrok tunnel? If FUSE fails, we fall back to
CloudBucketMount (a separate test). Egress is unrestricted on Modal so the tunnel works.

Run:  MODAL_TOKEN_ID=.. MODAL_TOKEN_SECRET=.. TUNNEL=https://..  python smoke.py
"""

import os
import modal

TUNNEL = os.environ["TUNNEL"]
SID = "modal-smoketest"
GEESEFS = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64"

app = modal.App.lookup("rivet-demo-smoke", create_if_missing=True)

img = (
    modal.Image.from_registry("debian:12-slim", add_python="3.11")
    .apt_install("fuse", "ca-certificates", "curl")
    .run_commands(
        f"curl -fsSL -o /usr/local/bin/geesefs {GEESEFS} && chmod +x /usr/local/bin/geesefs"
    )
)


def run(sb, cmd, timeout=120):
    p = sb.exec("bash", "-c", cmd, timeout=timeout)
    out = p.stdout.read()
    err = p.stderr.read()
    print(
        f"$ {cmd[:80]}\n  {out.strip()[:300]}"
        + (f"\n  ERR: {err.strip()[:200]}" if err.strip() else "")
    )
    return out


print("creating Modal VM-runtime sandbox...")
sb = modal.Sandbox.create(
    "sleep",
    "infinity",
    app=app,
    image=img,
    timeout=600,
    experimental_options={"vm_runtime": True},
)
print("sandbox:", sb.object_id)
try:
    run(sb, "ls -l /dev/fuse 2>&1 || echo NO_DEV_FUSE")
    run(sb, "geesefs --version 2>&1 | head -1")
    run(sb, "mkdir -p /root/work")
    mount = run(
        sb,
        f"AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret "
        f"geesefs --endpoint {TUNNEL} --region us-east-1 --no-detect --fsync-on-close "
        f"-o allow_other demo:{SID} /root/work && echo MOUNT_OK",
        timeout=90,
    )
    if "MOUNT_OK" in mount:
        run(
            sb,
            "echo 'modal durable write' > /root/work/modal-probe.txt && cat /root/work/modal-probe.txt && echo WROTE",
            timeout=90,
        )
    print("\n=== check SeaweedFS for demo/modal-smoketest/modal-probe.txt ===")
finally:
    sb.terminate()
    print("terminated")
