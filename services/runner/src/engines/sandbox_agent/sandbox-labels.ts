/**
 * The Daytona labels that say which session a sandbox belongs to.
 *
 * Both providers write them at create: the Daytona-path sandbox (`provider.ts`) and the in-process
 * command sandbox (`conversation-registry.ts`). One label list therefore finds every sandbox of a
 * session, and the same two values answer both "which sandboxes are these" and "may this request
 * delete them". The runner writes them from the request it serves, so they carry the trust of the
 * sandbox itself.
 */
export const PROJECT_LABEL = "agenta.project";
export const CONVERSATION_LABEL = "agenta.conversation";

/**
 * The inventory labels for one session. A missing id leaves its label out, so a sandbox that
 * cannot name both is never listed by the pair and is left to its owner and Daytona's timers.
 */
export function sessionSandboxLabels(
  projectId: string | undefined,
  sessionId: string | undefined,
): Record<string, string> {
  return {
    ...(projectId ? { [PROJECT_LABEL]: projectId } : {}),
    ...(sessionId ? { [CONVERSATION_LABEL]: sessionId } : {}),
  };
}
