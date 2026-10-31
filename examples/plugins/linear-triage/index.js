// Linear MCP returns either an object in structuredContent or JSON text content.
function unpack(result) {
  if (result.isError) throw new Error((result.content || []).map(c => c.text || "").join("\n") || "Linear refused the action");
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
  try { return JSON.parse(text); } catch { throw new Error("Linear returned an unexpected response. Check Linear before repeating a write."); }
}
const operations = {
  my_open_issues: async (_args, ctx) => {
    const data = unpack(await ctx.mcp("linear").call("list_issues", {assignee: "me", limit: 50}));
    const issues = Array.isArray(data) ? data : data.issues;
    if (!Array.isArray(issues)) throw new Error("Linear did not return an issue list.");
    return issues.filter(i => !i.archivedAt && !i.completedAt && !i.canceledAt && !["completed", "canceled", "cancelled", "done"].includes(String(i.statusType || i.state?.type || i.status || "").toLowerCase())).map(i => {
      const priority = Number(i.priority?.value ?? i.priority ?? 0);
      return {id: i.id, identifier: i.identifier || i.id, title: i.title, url: i.url, score: (priority >= 1 && priority <= 4 ? 5 - priority : 0) + (i.dueDate ? 2 : 0)};
    }).sort((a,b) => b.score - a.score);
  },
  bulk_label: async ({ids, label = "Urgent"}, ctx) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || ids.some(id => typeof id !== "string") || typeof label !== "string" || !label.trim()) throw new Error("Select between one and five issues and a label.");
    const labeled = [];
    for (const id of [...new Set(ids)]) {
      try {
        // Append atomically so concurrent label edits are preserved. Never retry an uncertain write.
        unpack(await ctx.mcp("linear").call("save_issue", {id, addLabels: [label]}));
        labeled.push(id);
      } catch (error) { return {labeled, uncertain: id, error: error.message, message: "Stopped. Check this issue in Linear before trying again."}; }
    }
    return {labeled};
  },
};
