import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  CLAUDE_DISALLOWED_TOOLS,
  claudeSessionOptionsMeta,
} from "../../src/engines/sandbox_agent/claude-session-options.ts";

describe("claudeSessionOptionsMeta", () => {
  it("pins the Claude Code built-in tools an Agenta run turns off", () => {
    // Changing this set changes what every Claude agent can call. Add a tool here only with a
    // reason in `claude-session-options.ts`.
    assert.deepEqual(
      [...claudeSessionOptionsMeta().claudeCode.options.disallowedTools].sort(),
      [
        "Agent",
        "Artifact",
        "ArtifactComments",
        "ArtifactData",
        "CronCreate",
        "CronDelete",
        "CronList",
        "DesignSync",
        "ListAgents",
        "PushNotification",
        "RemoteTrigger",
        "ReportFindings",
        "ScheduleWakeup",
        "SendMessage",
        "Task",
        "TaskCreate",
        "TaskGet",
        "TaskList",
        "TaskUpdate",
        "TeamCreate",
        "TeamDelete",
        "Workflow",
      ],
    );
  });

  it("keeps the file, shell, web, skill, and background-shell tools", () => {
    for (const tool of [
      "Bash",
      "Read",
      "Edit",
      "Write",
      "NotebookEdit",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "Skill",
      "ToolSearch",
      "TaskStop",
      "TaskOutput",
      "Monitor",
      "TodoWrite",
      "EnterPlanMode",
      "ExitPlanMode",
    ]) {
      assert.ok(
        !(CLAUDE_DISALLOWED_TOOLS as readonly string[]).includes(tool),
        `${tool} must stay available`,
      );
    }
  });

  it("turns off claude.ai connectors for the Claude Code process", () => {
    assert.deepEqual(claudeSessionOptionsMeta().claudeCode.options.env, {
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    });
  });

  it("keeps the visible adaptive thinking option", () => {
    assert.deepEqual(claudeSessionOptionsMeta().claudeCode.options.thinking, {
      type: "adaptive",
      display: "summarized",
    });
  });
});
