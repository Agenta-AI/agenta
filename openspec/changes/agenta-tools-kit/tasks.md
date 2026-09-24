# Tasks

These tasks describe future implementation. All remain unchecked. Mahmoud asked for the specification and the plan, not the implementation. Each numbered group ships as its own pull request, in order. [plan.md](plan.md) gives the files, tests, and commands for every task.

## 1. The kit on the agent service (SDK)

- [ ] 1.1 Add an optional default permission to platform operations and apply it in the platform resolver; verify that an author permission and an agent-wide `ask` or `deny` win, and that the default applies only under `allow_reads`.
- [ ] 1.2 Define the Agenta tools kit in the SDK; verify that every member is a real catalog operation, that no build-kit authoring tool is in it, and the default permission of each member.
- [ ] 1.3 Add the `agenta_tools` block to the agent template and its schema; verify the defaults when it is missing, and that an old SDK ignores it.
- [ ] 1.4 Write the function that adds the kit to a tool list; verify the switch, the duplicate rule, the test, evaluation, and automation filters, and the missing session or variant cases.
- [ ] 1.5 Call it in the agent handler before tools are resolved; verify a playground, API, channel, and automation run, a standalone run with no API address, and the rollback variable.

## 2. The build kit and run markers (API)

- [ ] 2.1 Remove the moved tools from the build kit; verify the overlay, the static workflow, and the template loader's first run.
- [ ] 2.2 Publish the kit as the read-only static workflow `__ag__agenta_tools`; verify that it lists the SDK kit and that a commit embedding it is refused.
- [ ] 2.3 Mark automation and evaluation runs with a run kind; verify the trigger dispatcher and both evaluation paths.

## 3. Instructions

- [ ] 3.1 Split the automation guidance from the configuration guidance and add the channel section; verify each section appears only with its tools, including a Slack run without `commit_revision`.

## 4. Playground block

- [ ] 4.1 Fetch the kit list in the web entities package; verify the fetch, the cache, and the failure case.
- [ ] 4.2 Add the Agenta tools block with a master switch and a row per tool that edits the draft; verify dirty state, commit, the "Set in your tools" rows, and the channel rows.
- [ ] 4.3 Check the run request and `/m`; verify that a draft switch reaches a playground run and that the build kit no longer sends the moved tools.

## 5. Channel tools

- [ ] 5.1 Add the four channel tools to the kit with the active-bot condition, replacing task 1.8 of the channel-tools change; verify the check runs only when a channel tool is on and that a failed check adds nothing.

## 6. Live QA

- [ ] 6.1 Run one agent in the playground, over the API, in Slack, in Telegram, in a schedule fire, and in an evaluation; record which tools each run offered and what each approval looked like.
