// Durability layer over the SandboxProvider interface from the rivet sandbox-agent SDK.
//
// A SandboxProvider implements the full sandbox lifecycle — create / reconnect /
// ensureServer / getUrl / destroy / kill — and `SandboxAgent.start({ sandbox })` drives all
// of it. withGeesefs() wraps a base provider and ADDS our geesefs-over-ngrok durable cwd
// (mount demo:<sid> over the tunnel + seed auth + start the credentialed agent server). One
// wrapper, reused across backends. `makeProvider(name, ctx)` returns the wrapped provider.
//
// Bases: daytona uses the SDK's built-in provider; e2b and docker use small custom bases
// here (the SDK's built-in e2b() calls a removed Sandbox.betaCreate, and its docker() owns
// the whole HostConfig so we can't add FUSE caps without clobbering the port mapping).
//
// Two backends are NOT here: local is the long-lived compose `sandbox` container (handled
// in server.js — geesefs talks to seaweedfs directly, creds already in its env); modal uses
// the dedicated Python bridge (provider-modal.js) since the Node modal SDK needs a
// separately-baked Modal image.

const NGROK_API = process.env.NGROK_API_URL || "http://ngrok:4040/api/tunnels";
const S3_ENDPOINT = process.env.SEAWEEDFS_S3_URL || "http://seaweedfs:8333";
const S3_KEY = process.env.SEAWEEDFS_S3_ACCESS_KEY || "demo";
const S3_SECRET = process.env.SEAWEEDFS_S3_SECRET_KEY || "demosecret";
const BUCKET = process.env.SEAWEEDFS_S3_BUCKET || "demo";
const AGENT_PORT = 2468;
const CWD = "/root/work";

// All baked images (daytona snapshot, e2b template, docker image) share one name.
const SNAPSHOT = process.env.DAYTONA_SNAPSHOT || "agenta-sandbox-agent";
const E2B_TEMPLATE = process.env.E2B_TEMPLATE || "agenta-sandbox-agent";
const DOCKER_IMAGE = process.env.SANDBOX_AGENT_IMAGE || "agenta-sandbox-agent:local";

async function tunnelUrl() {
  const r = await fetch(NGROK_API);
  if (!r.ok) throw new Error(`ngrok api ${r.status} — is the tunnel up? (compose --profile remote up -d ngrok)`);
  const d = await r.json();
  const t = (d.tunnels || []).find((x) => x.public_url?.startsWith("https"));
  if (!t) throw new Error("no https ngrok tunnel found");
  return t.public_url;
}

// mount demo:<sid> at cwd if not already healthily mounted. A stale FUSE endpoint reports
// as a mountpoint but errors "Transport endpoint is not connected" — remount.
function geesefsScript(sid, cwd, endpoint) {
  return [
    `if ls ${cwd} >/dev/null 2>&1 && mountpoint -q ${cwd}; then echo already; exit 0; fi`,
    `fusermount -u ${cwd} 2>/dev/null; umount -l ${cwd} 2>/dev/null; mkdir -p ${cwd}`,
    `AWS_ACCESS_KEY_ID=${S3_KEY} AWS_SECRET_ACCESS_KEY=${S3_SECRET} ` +
      `geesefs --endpoint ${endpoint} --region us-east-1 --no-detect --fsync-on-close ` +
      `-o allow_other ${BUCKET}:${sid} ${cwd} && echo MOUNT_OK`,
  ].join("; ");
}

function authScript(agentEnv) {
  const lines = [`mkdir -p /root/.config/pi && printf '{"defaultProjectTrust":"trusted"}' > /root/.config/pi/settings.json`];
  if (agentEnv.OPENAI_API_KEY)
    lines.push(`mkdir -p /root/.codex && printf '{"OPENAI_API_KEY":"%s"}' '${agentEnv.OPENAI_API_KEY}' > /root/.codex/auth.json`);
  return lines.join("; ");
}

// The built-in providers start the agent server with NO agent creds in its env (they only
// know about sandbox-agent, not which LLM key claude/codex need). Restart it once WITH the
// creds so prompts authenticate. Two hazards this avoids:
//  - pkill -f 'sandbox-agent server' would also kill the agent that's RUNNING this command
//    (our exec goes through the very server we'd be matching) → "signal: terminated". Kill
//    by port owner via fuser instead, which won't match our shell.
//  - the restarted server must outlive this command's shell → setsid + full detach.
// Written to a script + run via setsid so the parent exec can return immediately.
function restartServerWithCreds(agentEnv, port = AGENT_PORT) {
  const env = Object.entries(agentEnv).map(([k, v]) => `${k}='${v}'`).join(" ");
  return [
    `cat > /tmp/start-agent.sh <<'EOS'`,
    `#!/bin/bash`,
    `fuser -k ${port}/tcp 2>/dev/null; sleep 1`,
    `${env} exec sandbox-agent server --no-token --host 0.0.0.0 --port ${port} >/tmp/sa.log 2>&1`,
    `EOS`,
    `chmod +x /tmp/start-agent.sh`,
    `setsid /tmp/start-agent.sh </dev/null >/dev/null 2>&1 &`,
    `for i in $(seq 1 30); do curl -sf http://localhost:${port}/v1/health >/dev/null && echo SRV_UP && exit 0; sleep 1; done; echo SRV_DOWN`,
  ].join("\n");
}

// Wrap a base SandboxProvider with our durable cwd. `exec(sandboxId, cmd) -> stdout` is the
// backend-specific shell adapter. cwd is forced to CWD so resumeOrCreateSession lands in
// the mount regardless of the base provider's defaultCwd.
function withGeesefs(base, { sid, agentEnv, exec }) {
  const mount = async (sandboxId) => {
    const endpoint = await tunnelUrl();
    await exec(sandboxId, authScript(agentEnv));
    const out = await exec(sandboxId, geesefsScript(sid, CWD, endpoint));
    if (!/MOUNT_OK|already/.test(out)) throw new Error(`geesefs mount failed: ${out}`);
    const srv = await exec(sandboxId, restartServerWithCreds(agentEnv));
    if (!/SRV_UP/.test(srv)) throw new Error(`agent server restart failed: ${srv}`);
  };
  return {
    ...base,
    defaultCwd: CWD,
    // SandboxAgent.start() calls create() on a fresh sandbox and reconnect() on an existing
    // one, but only calls ensureServer() AFTER health failures. The base already starts the
    // server, so health passes first try and ensureServer never fires — so we mount in
    // create()/reconnect() (right after the sandbox exists), not ensureServer().
    async create() {
      const id = await base.create();
      await mount(id);
      return id;
    },
    async reconnect(sandboxId) {
      await base.reconnect?.(sandboxId);
      await base.ensureServer?.(sandboxId); // resumed sandbox may need the server restarted
      await mount(sandboxId);               // and the geesefs cwd remounted
    },
  };
}

// --- per-backend exec adapters: each backend hands us a different sandbox handle ---

const daytonaExec = async (sandboxId, cmd) => {
  const { Daytona } = await import("@daytonaio/sdk");
  const sbx = await new Daytona().get(sandboxId);
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, 90);
  return String(r.result || "");
};

const e2bExec = async (sandboxId, cmd) => {
  const { Sandbox } = await import("@e2b/code-interpreter");
  const sbx = await Sandbox.connect(sandboxId, { timeoutMs: 300000 });
  // e2b runs commands as a non-root user; agents + geesefs live under /root → sudo.
  const r = await sbx.commands.run(`sudo bash -c '${cmd.replace(/'/g, `'"'"'`)}'`, { timeoutMs: 120000 });
  return String(r.stdout || "");
};

const dockerExec = async (sandboxId, cmd) => {
  const Docker = (await import("dockerode")).default;
  const container = new Docker({ socketPath: "/var/run/docker.sock" }).getContainer(sandboxId);
  const e = await container.exec({ Cmd: ["bash", "-c", cmd], AttachStdout: true, AttachStderr: true });
  const stream = await e.start({});
  return await new Promise((resolve) => {
    let out = "";
    stream.on("data", (d) => (out += d.toString("utf8")));
    stream.on("end", () => resolve(out));
  });
};

// --- custom e2b base provider implementing the SDK's SandboxProvider interface. ---
// The SDK's built-in e2b() calls Sandbox.betaCreate, which doesn't exist in current
// @e2b/code-interpreter (sandbox-agent 0.4.2 references a removed API). Our template
// already bakes sandbox-agent + agents + geesefs, so we just create + start the server.
function e2bBase({ template, agentPort = AGENT_PORT } = {}) {
  const TIMEOUT = 600000;
  const connect = async (id) => (await import("@e2b/code-interpreter")).Sandbox.connect(id, { timeoutMs: TIMEOUT });
  return {
    name: "e2b",
    defaultCwd: "/root/work",
    // NOTE: create()/reconnect() deliberately DON'T start the agent server — withGeesefs
    // starts the only server (with creds) after mounting, so there's no credential-less
    // server to race with. ensureServer is a no-op for the same reason.
    async create() {
      const { Sandbox } = await import("@e2b/code-interpreter");
      const sbx = await Sandbox.create(template, { timeoutMs: TIMEOUT });
      return sbx.sandboxId;
    },
    async reconnect(id) { await connect(id); },
    async ensureServer() {},
    async getUrl(id) { return `https://${(await connect(id)).getHost(agentPort)}`; },
    async kill(id) { const { Sandbox } = await import("@e2b/code-interpreter"); await Sandbox.kill(id); },
    async destroy(id) { await this.kill(id); },
  };
}

// --- custom daytona base. The SDK's built-in daytona() starts a credential-less server in
// create() via executeCommand; our wrapper's restart can't reliably replace it because
// executeCommand runs as a child of that very server (killing it by port kills the exec
// shell mid-restart). So, like e2b/docker, this base does NOT start a server — withGeesefs
// starts the only one, with creds. ---
function daytonaBase({ snapshot, agentPort = AGENT_PORT } = {}) {
  const newClient = async () => new ((await import("@daytonaio/sdk")).Daytona)();
  return {
    name: "daytona",
    defaultCwd: CWD,
    async create() {
      const client = await newClient();
      const sbx = await client.create({ snapshot, autoStopInterval: 0 });
      return sbx.id;
    },
    async reconnect(id) {
      const client = await newClient();
      const sbx = await client.get(id);
      if (sbx.state === "stopped") await client.start(sbx);
    },
    async ensureServer() {},
    async getUrl(id) {
      const sbx = await (await newClient()).get(id);
      const p = await sbx.getSignedPreviewUrl(agentPort, 4 * 60 * 60);
      return typeof p === "string" ? p : p.url;
    },
    async destroy(id) { await (await (await newClient()).get(id)).delete(60); },
    async kill(id) { await this.destroy(id); },
  };
}

// --- custom docker base. The SDK's built-in docker() owns the whole HostConfig
// (PortBindings), so passing createContainerOptions to add FUSE caps would clobber the
// port mapping. We build the container ourselves with both. Like e2b, the server is
// started by withGeesefs (with creds), so create() doesn't start one. ---
function dockerBase({ image, agentPort = AGENT_PORT, host = "host.docker.internal" } = {}) {
  const sock = "/var/run/docker.sock";
  const newClient = async () => new ((await import("dockerode")).default)({ socketPath: sock });
  return {
    name: "docker",
    defaultCwd: "/root/work",
    async create() {
      const Docker = (await import("dockerode")).default;
      const getPort = (await import("get-port")).default;
      const client = new Docker({ socketPath: sock });
      const hostPort = await getPort();
      const container = await client.createContainer({
        Image: image,
        Entrypoint: ["sleep"],
        Cmd: ["infinity"],
        ExposedPorts: { [`${agentPort}/tcp`]: {} },
        HostConfig: {
          AutoRemove: true,
          PortBindings: { [`${agentPort}/tcp`]: [{ HostPort: String(hostPort) }] },
          Devices: [{ PathOnHost: "/dev/fuse", PathInContainer: "/dev/fuse", CgroupPermissions: "rwm" }],
          CapAdd: ["SYS_ADMIN"],
          SecurityOpt: ["apparmor:unconfined"],
        },
      });
      await container.start();
      return container.id;
    },
    async reconnect() {},
    async ensureServer() {},
    async getUrl(id) {
      const client = await newClient();
      const info = await client.getContainer(id).inspect();
      const hp = info.NetworkSettings?.Ports?.[`${agentPort}/tcp`]?.[0]?.HostPort;
      if (!hp) throw new Error(`docker: port ${agentPort} not published`);
      return `http://${host}:${hp}`;
    },
    async destroy(id) {
      const client = await newClient();
      const c = client.getContainer(id);
      try { await c.stop({ t: 5 }); } catch {}
      try { await c.remove({ force: true }); } catch {}
    },
    async kill(id) { await this.destroy(id); },
  };
}

// --- public factory: name -> wrapped provider ready for SandboxAgent.start() ---
export function makeProvider(name, { sid, agentEnv }) {
  switch (name) {
    case "daytona":
      return withGeesefs(daytonaBase({ snapshot: SNAPSHOT }), { sid, agentEnv, exec: daytonaExec });
    case "e2b":
      return withGeesefs(e2bBase({ template: E2B_TEMPLATE }), { sid, agentEnv, exec: e2bExec });
    case "docker":
      return withGeesefs(
        dockerBase({ image: DOCKER_IMAGE, agentPort: AGENT_PORT, host: process.env.DOCKER_HOST_IP || "host.docker.internal" }),
        { sid, agentEnv, exec: dockerExec },
      );
    default:
      throw new Error(`unknown sandbox provider: ${name}`);
  }
}

export { CWD, AGENT_PORT, S3_ENDPOINT };
