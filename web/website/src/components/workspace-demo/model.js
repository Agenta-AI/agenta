import {AREAS, LOGO, GLOBE, WEB, mask} from "./fixtures.js"

export function deriveWorkspace(state, setState) {
    const st = state
    const FG = "var(--foreground)",
        MF = "var(--muted-foreground)"
    const BRAND = [
        ["var(--demo-avatar-0)", "var(--demo-avatar-8)"],
        ["var(--demo-avatar-1)", "var(--demo-avatar-8)"],
        ["var(--demo-avatar-2)", "var(--demo-avatar-9)"],
        ["var(--demo-avatar-5)", "var(--demo-avatar-0)"],
        ["var(--demo-avatar-6)", "var(--demo-avatar-0)"],
        ["var(--demo-avatar-7)", "var(--demo-avatar-0)"],
        ["var(--demo-avatar-4)", "var(--demo-avatar-9)"],
        ["var(--demo-avatar-8)", "var(--demo-avatar-0)"],
    ]
    const FG_OF = (bg) => (BRAND.find((p) => p[0] === bg) || ["", "var(--demo-avatar-10)"])[1]
    const RING = "box-shadow:inset 0 0 0 1px rgba(127,127,127,0.28);"
    const AVATAR_COLORS = BRAND.map((p) => p[0])
    const agentAvatar = (name, id) => {
        const words = name.trim().split(/\s+/).filter(Boolean)
        const initials =
            (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "").slice(0, 2)) || "?"
        let hash = 0
        for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
        return {initials: initials.toUpperCase(), color: AVATAR_COLORS[hash % AVATAR_COLORS.length]}
    }
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
        RING
    const ALL = AREAS.flatMap((ar) => ar.items.map((it) => ({...it, area: ar.area})))
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
    ]
    const GREEN = "var(--ag-run-status-success)",
        AMBER = "var(--ag-run-status-warning)",
        GREY = "var(--ag-run-status-default)"
    const sessions = ALL.map((it, i) => {
        const m = it.meta.split(" · ")
        const av = agentAvatar(it.title, it.title)
        const waiting = i === 2,
            live = i === 0 || waiting,
            auto = i % 4 === 3
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
            open: () => setState({view: "playground", session: i}),
            steps: it.steps.map(([k, pre, bold, post]) => ({
                pre,
                bold,
                post,
                logoStyle: mask(k === WEB ? GLOBE : LOGO[k], 12),
            })),
            chipStyle: chipStyle(av.color, 24, 6),
            smallChipStyle: chipStyle(av.color, 20, 5),
            tileStyle: chipStyle(av.color, 34, 10),
            model: "Claude Sonnet 4.5",
            words: 180 + ((i * 37) % 200),
            toolCount: it.tools.length,
            mcpCount: it.tools.length,
            skillCount: 2 + (i % 3),
            files1: it.files,
        }
    })
    const views = ["home", "agents", "automations", "skills", "sessions", "playground"]
    const NAV_ROW =
        "position:relative;box-sizing:border-box;margin:0 auto 4px;display:flex;height:28px;flex:0 0 auto;width:calc(100% - 16px);align-items:center;gap:10px;border-radius:6px;padding:0 12px;font:400 14px/28px var(--font-sans);border:none;background:transparent;cursor:default;text-align:left;color:" +
        FG +
        ";"
    const SEL =
        "background:var(--ag-shell-selected-bg);font-weight:500;color:var(--ag-shell-selected-text);box-shadow:inset 0 0 0 1px var(--ag-shell-selected-border);"
    const nav = {}
    views.forEach((v) => {
        nav[v] = {
            go: () =>
                setState({
                    view: v,
                    session: v === "playground" ? (st.session ?? 0) : null,
                    automation: null,
                    skill: null,
                }),
            style: NAV_ROW + (st.view === v ? SEL : ""),
        }
    })
    const view = {}
    views.forEach((v) => {
        view[v] = st.view === v
    })
    const ss = sessions[st.session ?? 0]
    const railGroups = [0, 5, 10].map((i) => ({
        agent: sessions[i].title,
        rows: [sessions[i], sessions[i + 1]].map((r) => ({
            ...r,
            style:
                NAV_ROW +
                "font-size:13px;color:" +
                MF +
                ";" +
                (st.view === "playground" && st.session === sessions.indexOf(r) ? SEL : ""),
        })),
    }))
    // Home (HomeFocus)
    const homeTab = st.homeTab || "agents"
    const TAB =
        "box-sizing:border-box;cursor:default;border:none;border-bottom:2px solid transparent;background:transparent;padding:0 2px 7px;font:400 14px/1.4 var(--font-sans);color:" +
        MF +
        ";"
    const TAB_ON = "border-bottom-color:" + FG + ";font-weight:500;color:" + FG + ";"
    const ROWB =
        "box-sizing:border-box;display:flex;width:100%;cursor:default;align-items:center;gap:14px;border-radius:10px;border:none;background:transparent;padding:8px 14px;text-align:left;"
    const TEMPLATES = [
        ["Code review agent", "Reviews every pull request and leaves inline comments.", "var(--demo-avatar-0)"],
        [
            "Customer support agent",
            "Answers tickets from your docs and escalates the rest.",
            "var(--demo-avatar-5)",
        ],
        [
            "Lead research agent",
            "Researches inbound leads and drafts a first reply for review.",
            "var(--demo-avatar-2)",
        ],
        [
            "Knowledge agent",
            "Answers team questions from your docs, wiki, and past threads.",
            "var(--demo-avatar-7)",
        ],
        [
            "KPI dashboard agent",
            "Builds a weekly metrics dashboard and posts it to the team.",
            "var(--demo-avatar-1)",
        ],
    ]
    const homeSel = st.homeAgent ?? 0
    const homeRows =
        homeTab === "agents"
            ? sessions
                  .slice(0, 8)
                  .map((r, i) => ({
                      ...r,
                      selected: i === homeSel,
                      rowStyle: ROWB + (i === homeSel ? "background:var(--accent);" : ""),
                      open: () => setState({homeAgent: i}),
                  }))
            : TEMPLATES.map(([title, desc, color]) => ({
                  title,
                  desc,
                  initials: title
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase(),
                  tileStyle: chipStyle(color, 34, 10).replace("font:600 14px", "font:500 13px"),
                  selected: false,
                  rowStyle: ROWB,
                  open: () => setState({view: "agents"}),
              }))
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
            15,
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
            17,
            "Draft the changelog for this release.",
        ],
    ].map(([name, desc, kind, runsWhen, lastRun, ai, instruction], i) => {
        const ag = sessions[ai]
        const status = lastRun.includes("attention")
            ? "attention"
            : lastRun.includes("paused")
              ? "paused"
              : "working"
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
            agentHelper: "Brings " + ag.tools.join(", ") + " and " + (2 + (ai % 3)) + " skills.",
            runsHelper:
                status === "paused"
                    ? "Paused — it won't run until you switch it on."
                    : kind === "schedule"
                      ? "Next run " + runsWhen.replace("Every ", "").replace(" at ", " ") + "."
                      : "Runs each time this event arrives.",
            runsCaption: 12 + i * 3 + " runs · last " + lastRun.split(" · ")[0],
            open: () => setState({view: "automations", automation: i}),
        }
    })
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
        open: () => setState({skill: i}),
    }))
    const skillSections = [
        {label: "This project", count: 4, tag: null, skills: skillsAll.slice(0, 4)},
        {label: "Agenta built-in", count: 3, tag: "synced 3d ago", skills: skillsAll.slice(4)},
    ]
    // Playground
    const configOpen = st.configOpen !== false
    const TABC =
        "display:inline-flex;height:28px;max-width:200px;flex:0 0 auto;align-items:center;gap:6px;border-radius:6px;border:none;cursor:default;padding:0 10px;margin-right:5px;font:400 13px/1 var(--font-sans);"
    const agentSessions = sessions.filter((r) => r.area === ss.area).slice(0, 3)
    const tabs2 = (
        agentSessions.includes(ss) ? agentSessions : [ss, ...agentSessions.slice(0, 2)]
    ).map((r) => ({
        ...r,
        style:
            TABC +
            (r === ss
                ? "background:var(--ag-colorFillSecondary);color:" + FG + ";font-weight:500;"
                : "background:transparent;color:" + MF + ";"),
    }))
    const ssAutos = AUTOS.filter((au) => au.agent === ss.title)
    const ssFull = {
        ...ss,
        autos: ssAutos.length ? ssAutos : [AUTOS[0]],
        autoCount:
            (ssAutos.length || 1) +
            (ssAutos.length === 1 || !ssAutos.length ? " automation" : " automations"),
        fileCount: 3,
        files: [
            {name: ss.tools[0].toLowerCase() + "-notes.md", when: whens[st.session ?? 0]},
            {name: "AGENTS.md", when: "1w ago"},
            {name: "context/" + ss.area.toLowerCase() + ".md", when: "2w ago"},
        ],
    }
    return {
        nav,
        view,
        railGroups,
        ss: ssFull,
        homeAgent: sessions[homeSel],
        homeRows,
        homeShowTemplates: homeTab === "templates",
        homeTabAgents: () => setState({homeTab: "agents"}),
        homeTabTemplates: () => setState({homeTab: "templates"}),
        homeTabStyleAgents: TAB + (homeTab === "agents" ? TAB_ON : ""),
        homeTabStyleTemplates: TAB + (homeTab === "templates" ? TAB_ON : ""),
        agentRows: sessions.slice(0, 10),
        automationRows: AUTOS,
        hasAutomation: st.automation != null,
        noAutomation: st.automation == null,
        au: AUTOS[st.automation ?? 0],
        closeAutomation: () => setState({automation: null}),
        skillSections,
        hasSkill: st.skill != null,
        sk: skillsAll[st.skill ?? 0],
        closeSkill: () => setState({skill: null}),
        sessionRows: sessions.slice(0, 12),
        configOpen,
        configClosed: !configOpen,
        toggleConfig: () => setState({configOpen: !configOpen}),
        splitCols: configOpen ? "320px minmax(0,1fr)" : "minmax(0,1fr)",
        tabs2,
    }
}
