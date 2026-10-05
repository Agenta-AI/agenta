/**
 * The Daytona calls the command sandbox makes, each one bounded and cancellable.
 *
 * The SDK's HTTP client waits up to 24 hours per request and most methods take no AbortSignal,
 * so an unanswered request would hold a command, a Stop and every later command of the
 * conversation. `boundedDaytonaApi` makes every call race a deadline and the caller's signal.
 * Where the SDK accepts a signal (file streams) it gets it, so the request itself is cancelled;
 * elsewhere the request may still land after we gave up. `DaytonaCallTimeoutError` marks that
 * case: the outcome is unknown, and the caller decides whether the sandbox can still be trusted.
 */
import { Readable } from "node:stream";
import { Daytona, type Sandbox } from "@daytonaio/sdk";

export const abortedError = (): Error => new Error("aborted");

/** A Daytona request that did not answer in time: it may still have happened. */
export class DaytonaCallTimeoutError extends Error {
  constructor(readonly operation: string, readonly timeoutMs: number) {
    super(`Daytona did not answer '${operation}' within ${Math.round(timeoutMs / 1000)} s`);
    this.name = "DaytonaCallTimeoutError";
  }
}

/** Run `call` until it settles, `timeoutMs` passes, or `signal` aborts, whichever is first. */
export function bounded<T>(
  operation: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortedError());
  const deadline = new AbortController();
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.aborted ? abortedError() : new DaytonaCallTimeoutError(operation, timeoutMs));
    };
    combined.addEventListener("abort", onAbort, { once: true });
    call(combined).then(
      (value) => {
        clearTimeout(timer);
        combined.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        combined.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export interface NetworkSettings {
  networkBlockAll: boolean;
  networkAllowList?: string;
}

export interface CreateSandboxRequest {
  snapshot?: string;
  image?: string;
  labels: Record<string, string>;
  envVars: Record<string, string>;
  network: NetworkSettings;
  autoStopMinutes: number;
  autoDeleteMinutes: number;
}

export interface RunOptions {
  timeoutSeconds: number;
  cwd?: string;
  /** Passed as the request's environment, never written into the command text. */
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface CommandOutput {
  exitCode: number;
  output: string;
}

/** Deadlines per kind of call. Starting and creating wait for a VM; everything else is an API hop. */
export interface DaytonaDeadlines {
  controlMs: number;
  startMs: number;
  transferMs: number;
}

export const DEFAULT_DAYTONA_DEADLINES: DaytonaDeadlines = {
  controlMs: 30_000,
  startMs: 180_000,
  transferMs: 600_000,
};

/** One Daytona sandbox, as the command sandbox uses it. */
export interface DaytonaSandbox {
  readonly id: string;
  /** Daytona's state as of the last refresh. */
  readonly state: string | undefined;
  readonly labels: Readonly<Record<string, string>>;
  refresh(signal?: AbortSignal): Promise<void>;
  start(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  remove(signal?: AbortSignal): Promise<void>;
  updateNetwork(settings: NetworkSettings, signal?: AbortSignal): Promise<void>;
  /**
   * A shell command that returns its whole output: listings, tar, and the model command's
   * supervisor calls (launch, poll, kill), each of which prints a bounded answer.
   * `timeoutSeconds` bounds it inside the sandbox.
   */
  run(command: string, options: RunOptions): Promise<CommandOutput>;
  upload(source: AsyncIterable<Buffer>, remotePath: string, signal?: AbortSignal): Promise<void>;
  download(remotePath: string, signal?: AbortSignal): Promise<Readable>;
}

export interface DaytonaApi {
  create(request: CreateSandboxRequest, signal?: AbortSignal): Promise<DaytonaSandbox>;
}

export interface DaytonaConnection {
  apiKey: string;
  apiUrl?: string;
  target?: string;
}

/**
 * Every call of `api` and of the sandboxes it returns, bounded by `deadlines` and cancelled by
 * the caller's signal. The one place deadlines are applied, in production and in tests alike.
 */
export function boundedDaytonaApi(api: DaytonaApi, deadlines: DaytonaDeadlines = DEFAULT_DAYTONA_DEADLINES): DaytonaApi {
  const wrap = (sandbox: DaytonaSandbox) => new BoundedSandbox(sandbox, deadlines);
  return {
    create: async (request, signal) => wrap(await bounded("create sandbox", deadlines.startMs, signal, (s) => api.create(request, s))),
  };
}

class BoundedSandbox implements DaytonaSandbox {
  constructor(
    private readonly inner: DaytonaSandbox,
    private readonly deadlines: DaytonaDeadlines,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get state(): string | undefined {
    return this.inner.state;
  }

  get labels(): Readonly<Record<string, string>> {
    return this.inner.labels;
  }

  private control<T>(operation: string, signal: AbortSignal | undefined, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return bounded(`${operation} ${this.inner.id}`, this.deadlines.controlMs, signal, call);
  }

  refresh(signal?: AbortSignal): Promise<void> {
    return this.control("refresh", signal, (s) => this.inner.refresh(s));
  }

  start(signal?: AbortSignal): Promise<void> {
    return bounded(`start ${this.inner.id}`, this.deadlines.startMs, signal, (s) => this.inner.start(s));
  }

  stop(signal?: AbortSignal): Promise<void> {
    return bounded(`stop ${this.inner.id}`, this.deadlines.startMs, signal, (s) => this.inner.stop(s));
  }

  remove(signal?: AbortSignal): Promise<void> {
    return this.control("delete", signal, (s) => this.inner.remove(s));
  }

  updateNetwork(settings: NetworkSettings, signal?: AbortSignal): Promise<void> {
    return this.control("update network", signal, (s) => this.inner.updateNetwork(settings, s));
  }

  run(command: string, options: RunOptions): Promise<CommandOutput> {
    const deadline = options.timeoutSeconds * 1000 + this.deadlines.controlMs;
    return bounded(`command ${this.inner.id}`, deadline, options.signal, (s) => this.inner.run(command, { ...options, signal: s }));
  }

  upload(source: AsyncIterable<Buffer>, remotePath: string, signal?: AbortSignal): Promise<void> {
    return bounded(`upload ${this.inner.id}`, this.deadlines.transferMs, signal, (s) => this.inner.upload(source, remotePath, s));
  }

  /** The deadline covers the request; the caller bounds the body with its own signal. */
  download(remotePath: string, signal?: AbortSignal): Promise<Readable> {
    return this.control("download", signal, (s) => this.inner.download(remotePath, s));
  }
}

/** The Daytona SDK behind the interface above. Unbounded; `createDaytonaApi` bounds it. */
class SdkSandbox implements DaytonaSandbox {
  constructor(
    private readonly sandbox: Sandbox,
    private readonly startSeconds: number,
  ) {}

  get id(): string {
    return this.sandbox.id;
  }

  get state(): string | undefined {
    return this.sandbox.state;
  }

  get labels(): Readonly<Record<string, string>> {
    return this.sandbox.labels ?? {};
  }

  refresh(): Promise<void> {
    return this.sandbox.refreshData();
  }

  start(): Promise<void> {
    return this.sandbox.start(this.startSeconds);
  }

  stop(): Promise<void> {
    return this.sandbox.stop(this.startSeconds);
  }

  remove(): Promise<void> {
    return this.sandbox.delete(this.startSeconds);
  }

  updateNetwork(settings: NetworkSettings): Promise<void> {
    // `networkBlockAll: false` alone restores outbound access and clears a stored allow list.
    const payload = settings.networkBlockAll
      ? { networkBlockAll: true }
      : settings.networkAllowList
        ? { networkBlockAll: false, networkAllowList: settings.networkAllowList }
        : { networkBlockAll: false };
    return this.sandbox.updateNetworkSettings(payload);
  }

  async run(command: string, options: RunOptions): Promise<CommandOutput> {
    const r = await this.sandbox.process.executeCommand(command, options.cwd, options.env, options.timeoutSeconds);
    return { exitCode: r.exitCode, output: r.result ?? "" };
  }

  upload(source: AsyncIterable<Buffer>, remotePath: string, signal?: AbortSignal): Promise<void> {
    return this.sandbox.fs.uploadFileStream(Readable.from(source, { objectMode: false }), remotePath, { ...(signal ? { signal } : {}) });
  }

  download(remotePath: string, signal?: AbortSignal): Promise<Readable> {
    return this.sandbox.fs.downloadFileStream(remotePath, { ...(signal ? { signal } : {}) });
  }
}

export function createDaytonaApi(
  connection: DaytonaConnection,
  deadlines: DaytonaDeadlines = DEFAULT_DAYTONA_DEADLINES,
): DaytonaApi {
  const client = new Daytona({
    apiKey: connection.apiKey,
    ...(connection.apiUrl ? { apiUrl: connection.apiUrl } : {}),
    ...(connection.target ? { target: connection.target } : {}),
  });
  const startSeconds = Math.ceil(deadlines.startMs / 1000);
  const sdk: DaytonaApi = {
    async create(request) {
      const base = {
        labels: request.labels,
        envVars: request.envVars,
        networkBlockAll: request.network.networkBlockAll,
        ...(request.network.networkAllowList ? { networkAllowList: request.network.networkAllowList } : {}),
        autoStopInterval: request.autoStopMinutes,
        autoDeleteInterval: request.autoDeleteMinutes,
        ephemeral: false,
      };
      const created = request.image
        ? await client.create({ ...base, image: request.image }, { timeout: startSeconds })
        : await client.create({ ...base, ...(request.snapshot ? { snapshot: request.snapshot } : {}) }, { timeout: startSeconds });
      return new SdkSandbox(created, startSeconds);
    },
  };
  return boundedDaytonaApi(sdk, deadlines);
}
