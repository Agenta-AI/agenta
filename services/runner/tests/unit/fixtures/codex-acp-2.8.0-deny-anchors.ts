/**
 * Verbatim excerpts from the published `@agentclientprotocol/codex-acp@2.8.0`
 * `dist/index.js` (npm pack sha256
 * 4c281cfc52d7ba5b2584755343bd68392d0bd92240bdf3968ea73a9a6fea5782;
 * dist/index.js sha256
 * 5ef8603b90b86235bef6e9554d9b503de1688e72d0f277a6b98196233c40858d).
 *
 * Copied unchanged from that file. Do not rewrite these strings.
 */
export const CODEX_ACP_2_8_0_DENY_FIXTURE = `
  if (isToolApproval) {
    options.push(permissionOption2(
      McpApprovalOptionId.Cancel,
      "Cancel",
      "reject_once",
      "Cancel this tool call"
    ));
  } else {
    options.push(
      permissionOption2(
        McpApprovalOptionId.Decline,
        "Deny",
        "reject_once",
        "Decline this request and continue."
      ),
      permissionOption2(McpApprovalOptionId.Cancel, "Cancel", "reject_once", "Cancel this request")
    );
  }
  return options;
}

var McpApprovalOptionId = {
  AllowOnce: "allow_once",
  AllowSession: "allow_session",
  AllowAlways: "allow_always",
  Decline: "decline",
  Cancel: "cancel"
};

function convertMcpPermissionResponse(response, isToolApproval, persistOptions) {
  if (response.outcome.outcome !== "selected") return cancelledResponse();
  switch (response.outcome.optionId) {
    case McpApprovalOptionId.AllowSession:
      return persistOptions.has("session") ? { action: "accept", content: null, _meta: { persist: "session" } } : cancelledResponse();
    case McpApprovalOptionId.AllowAlways:
      return persistOptions.has("always") ? { action: "accept", content: null, _meta: { persist: "always" } } : cancelledResponse();
    case McpApprovalOptionId.AllowOnce:
      return isToolApproval ? { action: "accept", content: null, _meta: null } : cancelledResponse();
    case "accept":
      return !isToolApproval ? { action: "accept", content: null, _meta: null } : cancelledResponse();
    case McpApprovalOptionId.Decline:
      return !isToolApproval ? { action: "decline", content: null, _meta: null } : cancelledResponse();
    case McpApprovalOptionId.Cancel:
    default:
      return cancelledResponse();
  }
}
function cancelledResponse() {
  return { action: "cancel", content: null, _meta: null };
}

    if (CreateElicitationResponse2.isDecline(response)) {
      return context.isToolApproval ? { action: "cancel", content: null, _meta: elicitationResponseMeta(response, context) } : { action: "decline", content: null, _meta: elicitationResponseMeta(response, context) };
    }
    if (CreateElicitationResponse2.isCancel(response)) {
      return { action: "cancel", content: null, _meta: elicitationResponseMeta(response, context) };
    }
    if (CreateElicitationResponse2.isCustom(response)) {
      return { action: "cancel", content: null, _meta: null };
    }
    return { action: "cancel", content: null, _meta: null };
`;

/** Verbatim `McpApprovalOptionId` plus `convertMcpPermissionResponse` from the same bundle. */
export const CODEX_ACP_2_8_0_MCP_HELPERS = `
var McpApprovalOptionId = {
  AllowOnce: "allow_once",
  AllowSession: "allow_session",
  AllowAlways: "allow_always",
  Decline: "decline",
  Cancel: "cancel"
};

function convertMcpPermissionResponse(response, isToolApproval, persistOptions) {
  if (response.outcome.outcome !== "selected") return cancelledResponse();
  switch (response.outcome.optionId) {
    case McpApprovalOptionId.AllowSession:
      return persistOptions.has("session") ? { action: "accept", content: null, _meta: { persist: "session" } } : cancelledResponse();
    case McpApprovalOptionId.AllowAlways:
      return persistOptions.has("always") ? { action: "accept", content: null, _meta: { persist: "always" } } : cancelledResponse();
    case McpApprovalOptionId.AllowOnce:
      return isToolApproval ? { action: "accept", content: null, _meta: null } : cancelledResponse();
    case "accept":
      return !isToolApproval ? { action: "accept", content: null, _meta: null } : cancelledResponse();
    case McpApprovalOptionId.Decline:
      return !isToolApproval ? { action: "decline", content: null, _meta: null } : cancelledResponse();
    case McpApprovalOptionId.Cancel:
    default:
      return cancelledResponse();
  }
}
function cancelledResponse() {
  return { action: "cancel", content: null, _meta: null };
}
`;
