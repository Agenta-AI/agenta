import { AREAS, LOGO, GLOBE, WEB, mask } from "./fixtures.js";

export function deriveWorkspace(state, setState, onLive) {
  const st = state;
  const FG = "var(--foreground)",
    MF = "var(--muted-foreground)";
  const BRAND = [
    ["var(--demo-avatar-0)", "var(--demo-avatar-8)"],
    ["var(--demo-avatar-1)", "var(--demo-avatar-8)"],
    ["var(--demo-avatar-2)", "var(--demo-avatar-9)"],
    ["var(--demo-avatar-5)", "var(--demo-avatar-0)"],
    ["var(--demo-avatar-6)", "var(--demo-avatar-0)"],
    ["var(--demo-avatar-7)", "var(--demo-avatar-0)"],
    ["var(--demo-avatar-4)", "var(--demo-avatar-9)"],
    ["var(--demo-avatar-8)", "var(--demo-avatar-0)"],
  ];
  const FG_OF = (bg) =>
    (BRAND.find((p) => p[0] === bg) || ["", "var(--demo-avatar-10)"])[1];
  const RING = "box-shadow:inset 0 0 0 1px rgba(127,127,127,0.28);";
  const AVATAR_COLORS = BRAND.map((p) => p[0]);
  const agentAvatar = (name, id) => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const initials =
      (words.length > 1
        ? words[0][0] + words[1][0]
        : (words[0] || "").slice(0, 2)) || "?";
    let hash = 0;
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return {
      initials: initials.toUpperCase(),
      color: AVATAR_COLORS[hash % AVATAR_COLORS.length],
    };
  };
  const chipStyle = (color, size, radius) =>
    "display:inline-flex;width:" +
    size +
    "px;height:" +
    size +
    "px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:" +
    radius +
    "px;font:600 " +
    Math.round(size * 0.4) +
    "px/1 var(--font-sans);color:" +
    FG_OF(color) +
    ";background:" +
    color +
    ";" +
    RING;
  const ALL = AREAS.flatMap((ar) =>
    ar.items.map((it) => ({ ...it, area: ar.area })),
  );
  const whens = [
    "2m ago",
    "18m ago",
    "1h ago",
    "3h ago",
    "6h ago",
    "1d ago",
    "1d ago",
    "2d ago",
    "2d ago",
    "3d ago",
    "4d ago",
    "5d ago",
    "6d ago",
    "1w ago",
    "1w ago",
    "2w ago",
    "2w ago",
    "3w ago",
    "3w ago",
    "1mo ago",
    "1mo ago",
  ];
  const GREEN = "var(--ag-run-status-success)",
    AMBER = "var(--ag-run-status-warning)",
    GREY = "var(--ag-run-status-default)";
  const sessions = ALL.map((it, i) => {
    const m = it.meta.split(" · ");
    const av = agentAvatar(it.title, it.title);
    const waiting = i === 2,
      live = i === 0 || waiting,
      auto = i % 4 === 3;
    return {
      ...it,
      ...av,
      when: whens[i],
      dur: m[1],
      cost: m[3],
      waiting,
      auto,
      chat: !auto,
      live,
      dot: waiting ? AMBER : i === 0 ? GREEN : GREY,
      railDot: waiting ? AMBER : MF,
      railFill: live ? "currentColor" : "transparent",
      open: () =>
        setState({ view: "playground", session: i, playgroundTask: null }),
      steps: it.steps.map(([k, pre, bold, post]) => ({
        pre,
        bold,
        post,
        logoStyle: mask(k === WEB ? GLOBE : LOGO[k], 12),
      })),
      chipStyle: chipStyle(av.color, 24, 6),
      smallChipStyle: chipStyle(av.color, 20, 5),
      tileStyle: chipStyle(av.color, 34, 10),
      model: "Gemini 3.8",
      words: 180 + ((i * 37) % 200),
      toolCount: it.tools.length,
      mcpCount: it.tools.length,
      skillCount: 2 + (i % 3),
      files1: it.files,
    };
  });
  const views = [
    "home",
    "agents",
    "automations",
    "skills",
    "sessions",
    "playground",
  ];
  const NAV_ROW =
    "position:relative;box-sizing:border-box;margin:0 auto 4px;display:flex;height:28px;flex:0 0 auto;width:calc(100% - 16px);align-items:center;gap:10px;border-radius:6px;padding:0 12px;font:400 14px/28px var(--font-sans);border:none;background:transparent;cursor:default;text-align:left;color:" +
    FG +
    ";";
  const SEL =
    "background:var(--ag-shell-selected-bg);font-weight:500;color:var(--ag-shell-selected-text);box-shadow:inset 0 0 0 1px var(--ag-shell-selected-border);";
  const nav = {};
  views.forEach((v) => {
    nav[v] = {
      go: () =>
        setState({
          view: v,
          session: v === "playground" ? (st.session ?? 0) : null,
          automation: null,
          historyOpen: false,
          skill: null,
        }),
      style: NAV_ROW + (st.view === v ? SEL : ""),
    };
  });
  const view = {};
  views.forEach((v) => {
    view[v] = st.view === v;
  });
  const taskSteps = (steps) =>
    steps.map(([k, pre, bold, post = ""]) => ({
      pre,
      bold,
      post,
      logoStyle: mask(k === WEB ? GLOBE : LOGO[k], 12),
    }));
  // Mirrors the hero sidebar; the live task hands back to the hero's animated run.
  const playgroundGroups = [
    {
      sessionIndex: 7,
      label: "Lead Qualifier",
      tasks: [
        { name: "New leads from the website", live: true },
        {
          name: "Leads from the webinar",
          ask: "Qualify the 22 people who signed up for Tuesday's webinar.",
          worked: "Worked for 1m 12s",
          files1: "",
          meta: "2h ago · 1m 12s · 140K tokens · $0.012",
          steps: [
            ["HubSpot", "Read", "22 webinar sign-ups"],
            [WEB, "Researched", "company size and stack"],
            ["HubSpot", "Updated", "fit score on 22 contacts"],
          ],
          reply:
            "Five sign-ups match your ICP. I tagged them for follow-up and put the other 17 into the nurture list.",
        },
        {
          name: "Enrich the Acme list",
          ask: "Fill in role and company size for the Acme Retail contacts.",
          worked: "Worked for 54s",
          files1: "",
          meta: "1d ago · 54s · 88K tokens · $0.007",
          steps: [
            ["HubSpot", "Read", "18 Acme Retail contacts"],
            [WEB, "Found", "roles for 16 contacts"],
            ["HubSpot", "Updated", "16 contact records"],
          ],
          reply:
            "I added roles and company size for 16 of 18 contacts. Two had no public profile, so I flagged them for a manual check.",
        },
        {
          name: "Weekly pipeline review",
          ask: "Summarize this week's pipeline changes for the sales channel.",
          worked: "Worked for 1m 40s",
          files1: "1 file",
          meta: "3d ago · 1m 40s · 190K tokens · $0.016",
          steps: [
            ["HubSpot", "Read", "deals changed this week"],
            ["Notion", "Wrote", "Pipeline review · week 46"],
            ["Slack", "Posted", "summary to #sales"],
          ],
          reply:
            "Pipeline grew by $84K this week. Two deals moved to negotiation and one stalled. The full review is in Notion.",
        },
      ],
    },
    {
      sessionIndex: 10,
      label: "Meeting Follow-up",
      tasks: [
        {
          name: "Follow-up for the Northwind call",
          ask: "Write the follow-up email for today's Northwind call.",
          worked: "Worked for 48s",
          files1: "1 draft",
          meta: "1h ago · 48s · 76K tokens · $0.006",
          steps: [
            ["Drive", "Read", "Northwind call notes"],
            ["HubSpot", "Logged", "the call on the Northwind deal"],
            ["Gmail", "Drafted", "follow-up email", "for your review"],
          ],
          reply:
            "The follow-up recaps the three next steps you agreed on and proposes Tuesday at 14:00 for the technical review. It is waiting in your drafts.",
        },
        {
          name: "Notes from the Bloom demo",
          ask: "Turn the Bloom Studio demo recording into notes and next steps.",
          worked: "Worked for 1m 20s",
          files1: "1 file",
          meta: "1d ago · 1m 20s · 150K tokens · $0.013",
          steps: [
            ["Drive", "Read", "Bloom demo transcript"],
            ["Notion", "Wrote", "Demo notes · Bloom Studio"],
            ["Slack", "Posted", "next steps to #sales"],
          ],
          reply:
            "Bloom asked about pricing for small teams and a Figma integration. I wrote both up as open questions with owners in the notes.",
        },
      ],
    },
    {
      sessionIndex: 11,
      label: "Support Reply Drafter",
      tasks: [
        {
          name: "Refund question from Dana",
          ask: "Draft a reply to Dana's refund request.",
          worked: "Worked for 36s",
          files1: "",
          meta: "20m ago · 36s · 54K tokens · $0.004",
          steps: [
            ["Zendesk", "Read", "ticket #4821"],
            ["Stripe", "Checked", "Dana's last invoice"],
            ["Zendesk", "Drafted", "reply", "for approval"],
          ],
          reply:
            "Dana is inside the 30-day window, so the reply confirms a full refund in 5 to 7 days. It waits for your approval before it is sent.",
        },
        {
          name: "Login issue at Acme Retail",
          ask: "Help Acme Retail with their login problem.",
          worked: "Worked for 58s",
          files1: "",
          meta: "2h ago · 58s · 82K tokens · $0.007",
          steps: [
            ["Zendesk", "Read", "ticket #4817"],
            ["Notion", "Searched", "the SSO troubleshooting guide"],
            ["Zendesk", "Drafted", "reply with the fix"],
          ],
          reply:
            "Their SSO certificate expired yesterday. The reply explains how to upload a new one and links the guide.",
        },
        {
          name: "Invoice copy for Bloom",
          ask: "Send Bloom Studio a copy of their October invoice.",
          worked: "Worked for 22s",
          files1: "1 file",
          meta: "1d ago · 22s · 30K tokens · $0.002",
          steps: [
            ["Zendesk", "Read", "ticket #4809"],
            ["Stripe", "Downloaded", "October invoice"],
            ["Zendesk", "Drafted", "reply with the invoice"],
          ],
          reply:
            "I attached the October invoice to the reply. It is ready to send.",
        },
      ],
    },
  ];
  const isTask = (task) =>
    task.ask &&
    (task.ask === st.playgroundTask || task.name === st.playgroundTask);
  // The hero sidebar opens a task by name alone, so find its group from that.
  const activePlaygroundGroup =
    st.session == null && st.playgroundTask
      ? playgroundGroups.find((group) => group.tasks.some(isTask))
      : playgroundGroups.find(
          (group) => group.sessionIndex === (st.session ?? 0),
        );
  const activeSession =
    sessions[activePlaygroundGroup?.sessionIndex ?? st.session ?? 0];
  // A session opened from the Sessions list has no task and keeps its own thread.
  const activeTask =
    activePlaygroundGroup && st.playgroundTask
      ? (activePlaygroundGroup.tasks.find(isTask) ??
        activePlaygroundGroup.tasks.find((task) => !task.live))
      : null;
  const ss = activeTask
    ? { ...activeSession, ...activeTask, steps: taskSteps(activeTask.steps) }
    : activeSession;
  const railGroups = playgroundGroups.map((group) => ({
    sessionIndex: group.sessionIndex,
    agent: group.label ?? sessions[group.sessionIndex].title,
    rows: group.tasks.map((task) => ({
      ...sessions[group.sessionIndex],
      ...task,
      chat: true,
      auto: false,
      railDot: MF,
      railFill: task.live ? "currentColor" : "transparent",
      steps: taskSteps(task.steps ?? []),
      open: task.live
        ? () => onLive?.()
        : () =>
            setState({
              view: "playground",
              session: group.sessionIndex,
              playgroundTask: task.ask,
            }),
      style:
        NAV_ROW +
        "font-size:13px;color:" +
        MF +
        ";" +
        (st.view === "playground" && ss.ask === task.ask ? SEL : ""),
    })),
  }));
  // Every group stays listed, as in the landing hero's sidebar.
  const visibleRailGroups = railGroups;
  // Home (HomeFocus)
  const ROWB =
    "box-sizing:border-box;display:flex;width:100%;cursor:default;align-items:center;gap:14px;border-radius:10px;border:none;background:transparent;padding:8px 14px;text-align:left;";
  const homeSel = st.homeAgent ?? 0;
  const homeRows = sessions.slice(0, 8).map((r, i) => ({
    ...r,
    selected: i === homeSel,
    rowStyle: ROWB + (i === homeSel ? "background:var(--accent);" : ""),
    open: () => setState({ homeAgent: i, homePicker: false }),
  }));
  // Automations
  const AUTOS = [
    [
      "Weekly SEO article",
      "Researches, drafts and opens a PR for one article a week.",
      "schedule",
      "Every Monday at 09:00",
      "Mon 09:04 · ok",
      0,
      "Research our next best-tools article and prepare the brief in Notion, then draft it.",
    ],
    [
      "Triage overnight tickets",
      "Labels and routes everything that came in while the team was out.",
      "schedule",
      "Every day at 07:00",
      "Today 07:01 · ok",
      11,
      "Triage everything that came in overnight. Post urgent tickets to #support.",
    ],
    [
      "Review every pull request",
      "Reviews a PR the moment it is opened.",
      "event",
      "When a pull request is opened",
      "42m ago · needs attention",
      16,
      "Review this pull request for edge cases and missing checks.",
    ],
    [
      "Qualify inbound leads",
      "Scores each new lead against the ICP and routes it.",
      "event",
      "When a lead is created in HubSpot",
      "1h ago · ok",
      7,
      "Qualify this lead and assign it to the right owner.",
    ],
    [
      "Competitor digest",
      "A weekly read of what competitors shipped and said.",
      "schedule",
      "Every Friday at 16:00",
      "Fri 16:02 · ok",
      4,
      "Anything notable from competitors this week? Post a digest to #marketing.",
    ],
    [
      "Release changelog",
      "Writes the changelog from merged PRs when a release is tagged.",
      "event",
      "When a release is tagged",
      "3d ago · paused",
      18,
      "Draft the changelog for this release.",
    ],
  ].map(([name, desc, kind, runsWhen, lastRun, ai, instruction], i) => {
    const ag = sessions[ai];
    const status = lastRun.includes("attention")
      ? "attention"
      : lastRun.includes("paused")
        ? "paused"
        : "working";
    return {
      name,
      desc,
      kind,
      isEvent: kind === "event",
      isSchedule: kind === "schedule",
      runsWhen,
      lastRun,
      instruction,
      agent: ag.title,
      area: ag.area,
      agentInitials: ag.initials,
      agentChipStyle: chipStyle(ag.color, 20, 5),
      edited: whens[i + 2],
      statusLabel:
        status === "working"
          ? "Working"
          : status === "paused"
            ? "Paused"
            : "Needs attention",
      statusColor:
        status === "working"
          ? "var(--success)"
          : status === "paused"
            ? MF
            : "var(--destructive)",
      kindStyle:
        "display:flex;width:28px;height:28px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:6px;" +
        (kind === "event"
          ? "background:var(--ag-preset-orange-bg);color:var(--ag-preset-orange-text);"
          : "background:var(--ag-preset-purple-bg);color:var(--ag-preset-purple-text);"),
      agentHelper:
        "Brings " + ag.tools.join(", ") + " and " + (2 + (ai % 3)) + " skills.",
      runsHelper:
        status === "paused"
          ? "Paused — it won't run until you switch it on."
          : kind === "schedule"
            ? "Next run " +
              runsWhen.replace("Every ", "").replace(" at ", " ") +
              "."
            : "Runs each time this event arrives.",
      runsCaption:
        (runsWhen.includes("Monday") || runsWhen.includes("Friday")
          ? 4
          : 12 + i * 3) + " runs in the last 30 days",
      open: () =>
        setState({ view: "automations", automation: i, historyOpen: false }),
      transcript: ag,
      runCount:
        runsWhen.includes("Monday") || runsWhen.includes("Friday")
          ? 4
          : 12 + i * 3,
    };
  });
  // Skills
  const skillsAll = [
    [
      "research-brief",
      "Turn a topic into a sourced brief with search intent and outline.",
      "3 files · 3 agents · 2w",
      "project",
      "# research-brief\n\nInputs: topic, audience.\n1. Search the web and internal docs\n2. Cluster findings by intent\n3. Write a brief with sources\n\nOutput: a Notion page, linked in the reply.",
    ],
    [
      "draft-article",
      "Write a long-form draft from an approved brief, in the house voice.",
      "2 files · 2 agents · 2w",
      "project",
      "# draft-article\n\nInputs: brief URL.\n1. Read the brief and the style guide\n2. Draft sections, cite every claim\n3. Open a PR with the .mdx\n\nRules: no hype adjectives, sentence case.",
    ],
    [
      "classify-ticket",
      "Label a support ticket by category and priority.",
      "1 file · 2 agents · 1mo",
      "project",
      "# classify-ticket\n\nCategories: how-to, bug, billing, security.\nPriority from impact x reach.\nBilling and security escalate to a human.",
    ],
    [
      "score-fit",
      "Score a lead against the ICP, 1 to 5, with reasons.",
      "1 file · 2 agents · 3w",
      "project",
      "# score-fit\n\nSignals: size, industry, stack, role.\nBelow 2: recommend a polite pass.",
    ],
    [
      "review-diff",
      "Review a pull request against team conventions.",
      "2 files · 1 agent",
      "builtin",
      "# review-diff\n\n1. Read PR description and linked issue\n2. Review file by file\n3. Comment only where you would block a merge",
    ],
    [
      "publish-digest",
      "Post a short summary with links to a Slack channel.",
      "1 file · 4 agents",
      "builtin",
      "# publish-digest\n\nMax 5 lines. One link per item. No emoji.",
    ],
    [
      "schedule-run",
      "Create or update a schedule for the current agent.",
      "1 file · 5 agents",
      "builtin",
      "# schedule-run\n\nParse the cadence, confirm the timezone, create the schedule.",
    ],
  ].map(([slug, desc, meta, origin, md], i) => ({
    slug,
    desc,
    meta,
    md,
    builtin: origin === "builtin",
    project: origin !== "builtin",
    avatarStyle:
      "display:flex;width:28px;height:28px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:6px;font:600 11px/1 var(--font-mono);" +
      (origin === "builtin"
        ? "background:var(--ag-colorPrimary);color:var(--ag-colorBgContainer);"
        : "background:var(--demo-avatar-3);color:var(--demo-avatar-10);"),
    versions: ["v4", "v3", "v2"].map((v, j) => ({
      v,
      when: j === 0 ? "current · " + whens[i + 1] : whens[i + 4 + j],
      style: j === 0 ? "background:var(--accent);" : "",
    })),
    usedBy: [sessions[i], sessions[(i + 5) % sessions.length]],
    open: () => setState({ skill: i, skillVersion: "v4" }),
  }));
  const skillSections = [
    {
      label: "This project",
      count: 4,
      tag: null,
      skills: skillsAll.slice(0, 4),
    },
    {
      label: "Agenta built-in",
      count: 3,
      tag: "synced 3d ago",
      skills: skillsAll.slice(4),
    },
  ];
  // Configuration pane: the agent setup behind the open session.
  const configOpen = st.configOpen !== false;
  const ssAutos = AUTOS.filter((au) => au.agent === ss.title);
  const ssFull = {
    ...ss,
    autos: ssAutos.length
      ? ssAutos
      : AUTOS.filter((automation) => automation.area === ss.area),
    // Every app the agent's own sessions use, so the pane matches the chat.
    configIntegrations: [
      ...new Set([
        ...ss.tools,
        ...(activePlaygroundGroup?.tasks ?? [])
          .flatMap((task) => (task.steps ?? []).map((step) => step[0]))
          .filter((k) => k !== WEB && LOGO[k]),
      ]),
    ],
    configSkills: skillsAll
      .filter((skill) =>
        (ss.area === "Marketing"
          ? ["research-brief", "draft-article", "publish-digest"]
          : ss.area === "Sales"
            ? ["score-fit", "publish-digest", "schedule-run"]
            : ss.area === "Support"
              ? ["classify-ticket", "publish-digest", "schedule-run"]
              : ["review-diff", "publish-digest", "schedule-run"]
        ).includes(skill.slug),
      ),
    subagents: sessions
      .filter((agent) => agent.area === ss.area && agent.title !== ss.title)
      .slice(0, 2),
    files: [
      {
        name: ss.tools[0].toLowerCase() + "-notes.md",
        when: whens[st.session ?? 0],
      },
      { name: "AGENTS.md", when: "1w ago" },
      { name: "context/" + ss.area.toLowerCase() + ".md", when: "2w ago" },
    ],
  };
  return {
    nav,
    view,
    railGroups: visibleRailGroups,
    ss: ssFull,
    configOpen,
    toggleConfig: () => setState({ configOpen: !configOpen }),
    homeAgent: sessions[homeSel],
    homeRows,
    agentRows: sessions.slice(0, 10),
    automationRows: AUTOS,
    hasAutomation: st.automation != null,
    noAutomation: st.automation == null,
    au: AUTOS[st.automation ?? 0],
    closeAutomation: () => setState({ automation: null }),
    skillSections,
    hasSkill: st.skill != null,
    sk: skillsAll[st.skill ?? 0],
    closeSkill: () => setState({ skill: null }),
    sessionRows: sessions.slice(0, 12),
  };
}
