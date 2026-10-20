/**
 * The Claude Agent SDK options the runner sets on every Claude harness session.
 *
 * They ride `_meta.claudeCode.options`, which `claude-agent-acp` spreads into the SDK `query()`
 * options. The adapter appends its own `disallowedTools` (`AskUserQuestion` when the client has
 * no form elicitation) to ours and merges `env` over its process env.
 */
import { claudeThinkingMeta, type ClaudeThinkingMeta } from "./claude-thinking.ts";

/**
 * Claude Code built-in tools that have no meaning inside an Agenta agent run.
 *
 * - Multi-agent tools. An Agenta agent calls another agent through a subagent tool (a
 *   `{"type": "reference"}` tools entry). Claude Code's own subagents, teams, and messaging only
 *   reach agents inside the same CLI process, so a model that uses `SendMessage` or `ListAgents`
 *   to reach an Agenta agent gets "No reachable agents." and does not call the real tool.
 *   `Task` is the older name of `Agent`; the CLI still reports the tool under that name.
 * - Task-list tools. Agenta does not render Claude Code's task list.
 * - Scheduling tools. Their timers live in the CLI process, which ends with the run. Agenta has
 *   its own triggers.
 * - claude.ai and Claude app tools. They publish to, or notify through, the claude.ai account
 *   that a self-managed login brings, or they report to a Claude app UI that does not exist here.
 *
 * `TaskStop` and `Monitor` stay: they control the background shells that `Bash` starts.
 */
export const CLAUDE_DISALLOWED_TOOLS = [
  // Multi-agent
  "Agent",
  "Task",
  "SendMessage",
  "ListAgents",
  "TeamCreate",
  "TeamDelete",
  "Workflow",
  // Task list
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  // Scheduling
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  // claude.ai and Claude app surfaces
  "Artifact",
  "ArtifactComments",
  "ArtifactData",
  "DesignSync",
  "PushNotification",
  "ReportFindings",
] as const;

/**
 * Env for the Claude Code process. A self-managed login (a mounted `CLAUDE_CONFIG_DIR`) carries a
 * claude.ai account, and Claude Code would load that account's claude.ai connectors (Notion,
 * Gmail, and so on) as MCP servers. The run would then act on the account owner's data through
 * tools that the agent's config does not declare.
 */
export const CLAUDE_SESSION_ENV = {
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
} as const;

export interface ClaudeSessionOptionsMeta {
  claudeCode: {
    options: ClaudeThinkingMeta["claudeCode"]["options"] & {
      disallowedTools: string[];
      env: Record<string, string>;
    };
  };
}

export function claudeSessionOptionsMeta(): ClaudeSessionOptionsMeta {
  return {
    claudeCode: {
      options: {
        ...claudeThinkingMeta().claudeCode.options,
        disallowedTools: [...CLAUDE_DISALLOWED_TOOLS],
        env: { ...CLAUDE_SESSION_ENV },
      },
    },
  };
}
