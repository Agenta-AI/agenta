/** The one shape a saved subagent may take. A subagent always runs the target agent's latest
 *  revision, so a legacy pin (`version`, `environment`) or a forbidden `variant_id` is dropped
 *  on every write rather than left where no surface can show or clear it. `name` goes with them:
 *  a copy of the target's name went stale on a rename (#6444), so the slug is the only identity
 *  stored and every surface reads the current name off the agent it points at. */
export function normalizeSubagentReference(tool: Record<string, unknown>): Record<string, unknown> {
    const {
        variant_id: _variantId,
        version: _version,
        environment: _environment,
        name: _name,
        ref_by: _refBy,
        type: _type,
        ...rest
    } = tool
    return {type: "reference", ref_by: "variant", ...rest}
}
