/**
 * The client-tool relay contract — the seam a delivery channel pauses a browser-fulfilled
 * `client` tool through. Pure types only (no runtime code): the implementation is built by
 * `engines/sandbox_agent/client-tools.ts` (`buildClientToolRelay`), and it is consumed by the
 * Pi file relay (`tools/relay.ts` `startToolRelay`) and the Claude internal loopback MCP
 * server (`tools/tool-mcp-http.ts`).
 */
import type { ResolvedToolSpec } from "../protocol.ts";
import type { ClientToolOutcome } from "../responder.ts";

/** One client tool call as the delivery channel saw it: public name + args + resolved spec. */
export interface ClientToolRelayRequest {
  /** The interaction id (the FE matches a reply by it). */
  id: string;
  /** The channel-minted tool-call id (relay file id on Pi, a fresh UUID on the MCP channel). */
  toolCallId: string;
  toolName: string;
  input: unknown;
  spec: ResolvedToolSpec;
}

/**
 * The relay itself. The consumer calls `onClientTool` for each `client` tool call and then, on
 * a `pendingApproval` outcome, `onPause` to end the turn (the two-step shape mirrors the
 * previous inline engine behavior, so Pi is unchanged).
 */
export interface ClientToolRelay {
  onClientTool: (request: ClientToolRelayRequest) => Promise<ClientToolOutcome>;
  onPause?: (request: ClientToolRelayRequest) => void;
}
