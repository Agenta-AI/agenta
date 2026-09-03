/** The one shape a saved subagent may take. A subagent always runs the target agent's latest
 *  revision, so a legacy pin (`version`, `environment`) or a forbidden `variant_id` is dropped
 *  on every write rather than left where no surface can show or clear it. */
export function normalizeSubagentReference(tool: Record<string, unknown>): Record<string, unknown> {
    const {
        variant_id: _variantId,
        version: _version,
        environment: _environment,
        ref_by: _refBy,
        type: _type,
        ...rest
    } = tool
    return {type: "reference", ref_by: "variant", ...rest}
}
