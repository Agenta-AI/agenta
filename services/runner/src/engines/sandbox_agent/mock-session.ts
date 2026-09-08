/** The in-process `harness: "mock"` ACP session, and the wrapper that hands it out. */
import { randomUUID } from "node:crypto";

import { runMockBehavior, type MockBehaviorContext } from "./mock-behaviors.ts";
import { readMockConfig, type MockConfig } from "./mock-config.ts";

export interface MockSession {
  id: string;
  agentSessionId: string;
  onEvent: (handler: (event: unknown) => void) => void;
  onPermissionRequest: (handler: (request: unknown) => void) => void;
  respondPermission: (id: string, reply: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  getConfigOptions: () => Promise<unknown[]>;
  prompt: (blocks: unknown) => Promise<{ stopReason: string }>;
}

export function createMockSession(id: string, config: MockConfig): MockSession {
  let eventHandler: ((event: unknown) => void) | undefined;
  let permissionHandler: ((request: unknown) => void) | undefined;
  const pendingGates = new Map<string, (reply: string) => void>();
  let toolCallSeq = 0;

  const ctx: MockBehaviorContext = {
    emit: (update) => eventHandler?.({ payload: { update } }),
    nextToolCallId: () => `mock-${id}-${toolCallSeq++}`,
    requestPermission: ({ toolCallId, name }) => {
      const permissionId = `mock-perm-${toolCallId}`;
      const reply = new Promise<string>((resolve) => {
        pendingGates.set(permissionId, resolve);
      });
      permissionHandler?.({
        id: permissionId,
        availableReplies: ["once", "reject"],
        toolCall: { toolCallId, name, title: name, kind: name, rawInput: {} },
      });
      return reply;
    },
  };

  return {
    id,
    agentSessionId: `mock-native-${id}`,
    onEvent: (handler) => {
      eventHandler = handler;
    },
    onPermissionRequest: (handler) => {
      permissionHandler = handler;
    },
    respondPermission: async (permissionId, reply) => {
      pendingGates.get(permissionId)?.(reply);
      pendingGates.delete(permissionId);
    },
    // No network call, no real provider: the mock never rejects a model.
    setModel: async () => {},
    getConfigOptions: async () => [],
    prompt: () => runMockBehavior(config.behavior, config.kwargs, ctx),
  };
}

/** Override ONLY `createSession` on an already-real, already-acquired sandbox handle. */
export function wrapMockSandbox(sandbox: any, isDaytona: boolean): any {
  return new Proxy(sandbox, {
    get(target, prop, receiver) {
      if (prop === "createSession") {
        return async (request: { id?: string; cwd: string }) => {
          const config = await readMockConfig(target, request.cwd, isDaytona);
          return createMockSession(request.id ?? randomUUID(), config);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
