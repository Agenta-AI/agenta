/**
 * A Daytona stand-in for tests: every sandbox is a folder on this machine, and its commands are
 * real `bash` processes. The workspace sync and the command transaction run their real shell
 * scripts against it, so what is tested is what Daytona runs. Paths inside a sandbox are the
 * runner's paths under one folder (the workspace's `sandboxPrefix`); creating a sandbox empties
 * that folder, the way a new sandbox starts with an empty disk.
 *
 * Faults can be injected per sandbox: calls that never answer, calls that fail, late network
 * updates. Tests that need a finer fault wrap `run`.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CommandOutput, CreateSandboxRequest, DaytonaApi, DaytonaSandbox, NetworkSettings, RunOptions } from "../../src/engines/inprocess/sandbox/daytona-api.ts";

export type LocalSandboxOperation = "refresh" | "start" | "stop" | "remove" | "updateNetwork" | "run" | "upload" | "download";

export interface LocalSandboxFaults {
  /** Calls to these operations never settle. */
  hang?: Set<LocalSandboxOperation>;
  /** Calls to these operations reject. */
  fail?: Set<LocalSandboxOperation>;
  /** Network updates answer only after this long, and then take effect (a late update). */
  delayNetworkMs?: number;
}

const never = <T>(): Promise<T> => new Promise<T>(() => {});

export class LocalSandbox implements DaytonaSandbox {
  state: string | undefined = "started";
  labels: Record<string, string>;
  readonly envVars: Record<string, string>;
  readonly networkUpdates: NetworkSettings[] = [];
  network: NetworkSettings;
  readonly calls: LocalSandboxOperation[] = [];
  /** Every command text `run` received. */
  readonly commands: string[] = [];
  faults: LocalSandboxFaults = {};
  deleted = false;
  readonly createdAt = Date.now();
  /** Called when the sandbox stops or is deleted: what lives only while it runs (mounts) goes. */
  readonly onStop: Array<() => void> = [];

  constructor(
    readonly id: string,
    /** The folder that plays this sandbox's "/". */
    readonly prefix: string,
    request: CreateSandboxRequest,
  ) {
    this.labels = { ...request.labels };
    this.envVars = { ...request.envVars };
    this.network = request.network;
    mkdirSync(prefix, { recursive: true });
  }

  private async enter(operation: LocalSandboxOperation): Promise<void> {
    this.calls.push(operation);
    if (this.faults.hang?.has(operation)) return never();
    if (this.faults.fail?.has(operation)) throw new Error(`injected failure: ${operation}`);
    if (this.deleted) throw new Error(`sandbox ${this.id} not found`);
  }

  private requireStarted(): void {
    if (this.state !== "started") throw new Error(`sandbox ${this.id} is ${this.state}`);
  }

  async refresh(): Promise<void> {
    await this.enter("refresh");
  }

  async start(): Promise<void> {
    await this.enter("start");
    this.state = "started";
  }

  async stop(): Promise<void> {
    await this.enter("stop");
    this.state = "stopped";
    this.stopped();
  }

  async remove(): Promise<void> {
    await this.enter("remove");
    this.deleted = true;
    this.state = "destroyed";
    this.stopped();
  }

  /** Daytona stopped the sandbox behind the runner's back. */
  stopOutside(): void {
    this.state = "stopped";
    this.stopped();
  }

  private stopped(): void {
    for (const hook of this.onStop.splice(0)) hook();
  }

  async updateNetwork(settings: NetworkSettings): Promise<void> {
    await this.enter("updateNetwork");
    if (this.faults.delayNetworkMs) await new Promise((resolve) => setTimeout(resolve, this.faults.delayNetworkMs));
    this.network = settings;
    this.networkUpdates.push(settings);
  }

  async run(command: string, options: RunOptions): Promise<CommandOutput> {
    await this.enter("run");
    this.requireStarted();
    this.commands.push(command);
    const child = spawn("bash", ["-c", command], {
      cwd: options.cwd ?? "/",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: this.prefix, ...this.envVars, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout!.on("data", (d) => (output += String(d)));
    child.stderr!.on("data", (d) => (output += String(d)));
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutSeconds * 1000);
    const exitCode = await new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? -1)));
    clearTimeout(timer);
    return { exitCode, output };
  }

  async upload(source: AsyncIterable<Buffer>, remotePath: string): Promise<void> {
    await this.enter("upload");
    await pipeline(Readable.from(source), createWriteStream(remotePath));
  }

  async download(remotePath: string): Promise<Readable> {
    await this.enter("download");
    return createReadStream(remotePath);
  }
}

export class LocalDaytona implements DaytonaApi {
  readonly sandboxes = new Map<string, LocalSandbox>();
  /** Faults applied to every sandbox this creates. */
  defaultFaults: LocalSandboxFaults = {};
  creates = 0;

  constructor(
    /** The folder that plays the sandbox's "/". */
    readonly prefix: string,
  ) {}

  /** Each create takes the next message and fails with it, until the list is empty. */
  createFailures: string[] = [];
  readonly createRequests: CreateSandboxRequest[] = [];

  async create(request: CreateSandboxRequest): Promise<LocalSandbox> {
    this.createRequests.push(request);
    const failure = this.createFailures.shift();
    if (failure) throw new Error(failure);
    this.creates += 1;
    const id = `local-${randomUUID().slice(0, 8)}`;
    rmSync(this.prefix, { recursive: true, force: true });
    const sandbox = new LocalSandbox(id, this.prefix, request);
    sandbox.faults = { ...this.defaultFaults };
    this.sandboxes.set(id, sandbox);
    return sandbox;
  }
}
