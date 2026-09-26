import { randomBytes } from "node:crypto";

import type { AgentRunRequest, AgentUsage } from "../../protocol.ts";
import {
  modelEnvironmentSecretValues,
  sandboxVisibleSecretValues,
  type Redactor,
} from "../../redaction.ts";
import type { createSandboxAgentOtel } from "../../tracing/otel.ts";
import { servedByCustomConnection } from "../../tracing/custom-connection.ts";
import { createPiTraceTurnExport } from "../../tracing/pi-trace-turn-export.ts";
import {
  PI_TRACE_CONTROL_VERSION,
  type PiTurnTraceControl,
} from "../../tracing/pi-spool-protocol.ts";
import {
  localTelemetryFileHost,
  sandboxTelemetryFileHost,
} from "../../tracing/telemetry-file-host.ts";
import type { SessionEnvironment } from "./runtime-contracts.ts";
import type { RunOtlpTarget } from "./runtime-policy.ts";
import { readRunUsage } from "./usage.ts";

type TraceRun = ReturnType<typeof createSandboxAgentOtel>;

export interface HarnessTraceFinish {
  pickedUpBatches: number;
}

export interface HarnessTracePort {
  /** False when the harness publishes its own native spans through this port. */
  runnerEmitsSpans: boolean;
  start(run: TraceRun, redactor: Redactor): Promise<void>;
  traceId(run: TraceRun): string | undefined;
  cancelBeforeDrain(): Promise<void>;
  finish(): Promise<HarnessTraceFinish | undefined>;
  /**
   * The turn's parked prompt has finished and the turn now sends a second prompt (a decision
   * followed by fresh user text). Export what the finished prompt traced and return the usage it
   * reported, then open the trace for the second prompt. Runner-traced harnesses do nothing here:
   * their prompt responses carry the usage.
   */
  beginNextPrompt(
    run: TraceRun,
    redactor: Redactor,
  ): Promise<AgentUsage | undefined>;
  emitMissingBatchFallback(run?: TraceRun, message?: string): Promise<void>;
}

function runnerTracePort(): HarnessTracePort {
  return {
    runnerEmitsSpans: true,
    start: async () => {},
    traceId: (run) => run.traceId(),
    cancelBeforeDrain: async () => {},
    finish: async () => undefined,
    beginNextPrompt: async () => undefined,
    emitMissingBatchFallback: async () => {},
  };
}

function piTracePort(options: {
  env: SessionEnvironment;
  request: () => AgentRunRequest;
  target: RunOtlpTarget;
  resume: boolean;
  nextPromptFollows?: boolean;
}): HarnessTracePort {
  const { env, target } = options;
  const { plan, logger } = env;
  let fallbackEmitted = false;

  const cancelBeforeDrain = async (): Promise<void> => {
    if (env.sessionDestroyRequested) return;
    env.mcpAbort.abort();
    env.sessionDestroyRequested = true;
    try {
      await env.sandbox.destroySession?.(env.session.id);
    } catch (error) {
      logger(
        "stage=pi_trace_cancel failed=true error=" +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const finish = async (): Promise<HarnessTraceFinish> => {
    const traceExport = env.piTraceExport;
    if (!traceExport) return { pickedUpBatches: 0 };
    traceExport.updatePlatformAuthorization(target.authorization);
    try {
      return {
        pickedUpBatches: (await traceExport.finish()).pickedUpBatches,
      };
    } catch (error) {
      logger(
        "stage=pi_trace_spool_finish failed=true error=" +
          (error instanceof Error ? error.message : String(error)),
      );
      return { pickedUpBatches: 0 };
    }
  };

  const openTurnChannel = async (
    run: TraceRun,
    redactor: Redactor,
  ): Promise<void> => {
    const request = options.request();
    const exportContext = {
      endpoint: target.endpoint,
      authorization: target.authorization,
      authorizationSource: target.authorizationSource,
      redactor,
      traceId: run.traceId(),
      placement: plan.isDaytona ? ("daytona" as const) : ("local" as const),
      turnId: request.turnId?.trim() || undefined,
      onMissingBatch: async (message: string) => {
        run.recordError(message, request.modelConnection?.provider);
        await run.flush();
        logger("stage=pi_trace_missing_batch diagnostic=true");
      },
    };

    await env.piTraceExport?.teardown().catch(() => {});
    const host = plan.isDaytona
      ? sandboxTelemetryFileHost(env.sandbox)
      : localTelemetryFileHost();

    // The usage path is stable across warm turns. Remove the preceding turn value before Pi
    // starts, so a missing write can never be mistaken for current usage.
    if (plan.workspace.usageOutPath) {
      await host.remove(plan.workspace.usageOutPath).catch(() => {});
    }

    const channelId = randomBytes(16).toString("hex");
    const traceExport = createPiTraceTurnExport({
      host,
      dir: plan.workspace.telemetryDir,
      channelId,
      context: exportContext,
      log: logger,
    });
    env.piTraceExport = traceExport;

    const control: PiTurnTraceControl = {
      version: PI_TRACE_CONTROL_VERSION,
      channelId,
      turnId: request.turnId?.trim() || undefined,
      sessionId: env.sessionId || undefined,
      propagation: {
        traceparent: request.context?.propagation?.traceparent,
        baggage: request.context?.propagation?.baggage,
      },
      capture: {
        content: request.telemetry?.capture?.content?.enabled !== false,
      },
      skills: plan.workspace.skillDirs.map((skill) => skill.name),
      skillsDropped: plan.workspace.skillsDropped,
      ...(servedByCustomConnection(request.modelConnection)
        ? { customConnection: true }
        : {}),
      // Only secret values visible inside the sandbox cross this boundary. Approved public
      // model configuration and the runner OTLP authorization never enter the control file.
      redaction: {
        knownValues: [
          ...new Set(
            [
              ...(request.sandboxCredentials ?? []).map(
                (credential) => credential.value,
              ),
              ...modelEnvironmentSecretValues(
                request.modelConnection?.environment,
              ),
              ...sandboxVisibleSecretValues(env),
            ].filter((value): value is string => !!value),
          ),
        ],
      },
    };
    if (!(await traceExport.publishControl(control))) {
      logger("stage=pi_trace_control tracing_disabled=true");
    }
  };

  return {
    runnerEmitsSpans: false,
    start: async (run, redactor) => {
      if (options.resume || options.nextPromptFollows) {
        // This is still the original Pi prompt. Keep its channel and target. Only the platform
        // credential may rotate; an external collector keeps the original exporter header.
        // A decision-then-prompt turn keeps it too: the parked prompt publishes its trace and
        // usage on this channel when it settles, and `beginNextPrompt` drains them.
        env.piTraceExport?.updatePlatformAuthorization(target.authorization);
        return;
      }
      await openTurnChannel(run, redactor);
    },
    // A decision-then-prompt turn reports the second prompt's trace, which is this run's.
    traceId: (run) =>
      options.nextPromptFollows
        ? run.traceId()
        : (env.piTraceExport?.traceId() ?? run.traceId()),
    cancelBeforeDrain,
    finish,
    beginNextPrompt: async (run, redactor) => {
      // Pi writes the usage sidecar right before its trace batch, so the drain is the barrier
      // that makes the sidecar safe to read (see `runTurn`).
      await finish();
      const usage = await readRunUsage(
        env.sandbox,
        plan.workspace.usageOutPath,
        plan.isDaytona,
      );
      await openTurnChannel(run, redactor);
      return usage;
    },
    emitMissingBatchFallback: async (
      run,
      message = "Pi did not publish a valid trace batch before the turn ended",
    ) => {
      const traceExport = env.piTraceExport;
      if (traceExport) {
        try {
          await traceExport.emitMissingBatchFallback(message);
        } catch (error) {
          logger(
            "stage=pi_trace_fallback failed=true error=" +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        return;
      }
      if (fallbackEmitted) return;
      fallbackEmitted = true;
      run?.recordError(message, options.request().modelConnection?.provider);
      await run?.flush();
      logger("stage=pi_trace_missing_batch diagnostic=true");
    },
  };
}

/**
 * One narrow port for harness trace ownership. Most harnesses use runner-created spans; Pi owns
 * native span semantics and supplies the same lifecycle operations through its adapter.
 */
export function createHarnessTracePort(options: {
  env: SessionEnvironment;
  request: () => AgentRunRequest;
  target: RunOtlpTarget;
  resume: boolean;
  /** A decision-then-prompt turn: the parked prompt finishes, then a second prompt follows. */
  nextPromptFollows?: boolean;
}): HarnessTracePort {
  return options.env.plan.isPi ? piTracePort(options) : runnerTracePort();
}
