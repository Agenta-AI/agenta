/**
 * Send a harness that runs in this process to the model gateway over the in-network api hop.
 *
 * The platform writes the gateway route into the run against the PUBLIC api base
 * (`PlatformConnection.gateway_base_url` in the SDK), because a Daytona sandbox can only reach the
 * public one. In-process Pi runs in the runner itself, which reaches the api directly at
 * `AGENTA_API_INTERNAL_URL`, the same hop the runner already uses for sessions and traces. Through
 * the public base every model call leaves the cluster and comes back in through the load balancer.
 *
 * Only a gateway route (the request carries gateway credentials) on the configured public base is
 * moved, and only for a provider whose harness runs in the runner. Daytona runs, direct provider
 * endpoints, and deployments without an internal api base keep the route they were handed.
 */

import { inNetworkApiRoute } from "../../apiBase.ts";
import { sandboxProviderTraits } from "../../config/runner-config.ts";
import type { AgentRunRequest } from "../../protocol.ts";
import { resolveSandboxProviderId } from "./run-plan.ts";

type Log = (message: string) => void;

/** Move `request`'s gateway route onto the in-network hop. Called once, after sandbox routing. */
export function routeGatewayInNetwork(request: AgentRunRequest, log: Log = () => {}): void {
  if (!sandboxProviderTraits(resolveSandboxProviderId(request)).harnessInRunner) return;
  const connection = request.modelConnection;
  const baseUrl = connection?.endpoint?.baseUrl;
  if (!connection?.gatewayCredentials || !baseUrl) return;
  const inNetwork = inNetworkApiRoute(baseUrl);
  if (!inNetwork) return;
  connection.endpoint = { ...connection.endpoint, baseUrl: inNetwork };
  log("[gateway-route] model gateway reached over the in-network api base");
}
