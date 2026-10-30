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
    return issues.filter(i => !["completed", "canceled", "cancelled", "done"].includes(String(i.state?.type || i.status || "").toLowerCase())).map(i => ({id: i.id, identifier: i.identifier, title: i.title, url: i.url, score: (i.priority ? 5 - Number(i.priority) : 0) + (i.dueDate ? 2 : 0)})).sort((a,b) => b.score - a.score);
  },
  bulk_label: async ({ids, label = "Urgent"}, ctx) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || ids.some(id => typeof id !== "string") || typeof label !== "string" || !label.trim()) throw new Error("Select between one and five issues and a label.");
    const labeled = [];
    for (const id of [...new Set(ids)]) {
      try {
        const issue = unpack(await ctx.mcp("linear").call("get_issue", {id}));
        const labels = (issue.labels || []).map(l => typeof l === "string" ? l : l.name);
        // Preserve existing labels. Never retry an update after an ambiguous failure.
        unpack(await ctx.mcp("linear").call("update_issue", {id, labels: [...new Set([...labels, label])]}));
        labeled.push(id);
      } catch (error) { return {labeled, uncertain: id, error: error.message, message: "Stopped. Check this issue in Linear before trying again."}; }
    }
    return {labeled};
  },
};
