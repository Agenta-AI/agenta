// Sample data for the hero mockup of the Agenta app. One workspace, a few agents.
// Copy follows the app's own strings (web/packages/agenta-i18n/locales/en on main).

export const WORKSPACE = {
  name: "Acme Agency",
  initials: "AA",
  user: { name: "Maya Brooks", email: "maya@acme-agency.com", initials: "MB" },
};

// Agent icon colours: the solid and tint pairs of @agenta/ui/agent-icon/colors.ts.
export const AGENTS = [
  {
    id: "support",
    name: "Support triage",
    desc: "Labels new Zendesk tickets and drafts the first reply",
    icon: "headset",
    color: ["#113955", "#E5F1F9"],
    owner: "You",
    lastActive: "2 min ago",
    group: "Waiting",
    waiting: 1,
    version: "v4",
    savedAgo: "2 h ago",
    model: {
      name: "Claude Sonnet 5.5",
      id: "claude-sonnet-5-5",
      harness: "Claude Code",
      provider: "anthropic",
    },
    instructions: {
      words: 33,
      text: "You are Support triage. You read each new support ticket, decide its urgency and category, label it in Zendesk, and draft a first reply in plain words. You never send a reply yourself.",
      md: [
        [
          "Role",
          "You read each new support ticket, decide its urgency and category, label it in Zendesk, and draft a first reply.",
        ],
        [
          "Urgency",
          "A bug is medium unless money is involved. Billing problems are always high.",
        ],
        ["Replies", "Write in plain words. You never send a reply yourself."],
      ],
    },
    integrations: [
      { name: "Zendesk", sub: "Integration · Zendesk", mark: "zendesk" },
    ],
    subagents: [],
    mcp: [],
    skills: ["ticket-triage", "refund-policy"],
    secrets: [
      { name: "ZENDESK_SUBDOMAIN", sub: "Secret · project vault" },
      { name: "BILLING_API_KEY", sub: "Secret · project vault" },
    ],
    permission: "Allow reads",
    automations: {
      scheduled: [{ name: "Daily summary", when: "Every day at 09:00" }],
      app: [
        {
          name: "New Zendesk ticket",
          when: "When a ticket is created in Zendesk",
        },
      ],
    },
    channels: { slack: "connected" },
  },
  {
    id: "seo",
    name: "SEO Content Agent",
    desc: "Writes SEO briefs and drafts blog posts from Search Console data",
    icon: "pen",
    color: ["#0F766E", "#E3F2F0"],
    owner: "You",
    lastActive: "1 h ago",
    group: "This week",
    version: "v1",
    savedAgo: "just now",
    model: {
      name: "Claude Sonnet 5.5",
      id: "claude-sonnet-5-5",
      harness: "Claude Code",
      provider: "anthropic",
    },
    instructions: {
      words: 41,
      text: "You are the SEO Content Agent. You pick the keywords worth a post from Search Console, write a brief for each, and draft the post in our brand voice. You save every draft in Notion for review.",
      md: [
        [
          "Role",
          "You pick the keywords worth a post from Search Console and write a brief for each one.",
        ],
        [
          "Drafts",
          "Draft the post in our brand voice. Save every draft in Notion for review.",
        ],
        ["Rules", "Never publish. Link to two of our own posts in each draft."],
      ],
    },
    integrations: [
      {
        name: "Google Search Console",
        sub: "Integration · Google Search Console",
        mark: "google_search_console",
      },
      { name: "Notion", sub: "Integration · Notion", mark: "notion" },
    ],
    subagents: [],
    mcp: [],
    skills: ["seo-brief-writer", "brand-voice"],
    secrets: [],
    permission: "Ask",
    automations: {
      scheduled: [
        { name: "Weekly keyword report", when: "Every Monday at 08:00" },
      ],
      app: [],
    },
    channels: {},
  },
  {
    id: "lead",
    name: "Lead Qualifier",
    desc: "Scores new website leads and adds them to HubSpot",
    icon: "target",
    color: ["#7C3AED", "#F1EBFD"],
    owner: "Sam Ortiz",
    lastActive: "Yesterday",
    group: "This week",
    version: "v7",
    savedAgo: "3 d ago",
    model: {
      name: "GPT-5.5 mini",
      id: "gpt-5.5-mini",
      harness: "Pi",
      provider: "openai",
    },
    instructions: {
      words: 28,
      text: "You are the Lead Qualifier. You score each new lead from the website form against our criteria and add it to HubSpot. You post hot leads in #sales.",
      md: [
        [
          "Role",
          "Score each new lead from the website form against our criteria.",
        ],
        ["Hand-off", "Add every lead to HubSpot. Post hot leads in #sales."],
      ],
    },
    integrations: [
      { name: "HubSpot", sub: "Integration · HubSpot", mark: "hubspot" },
      { name: "Slack", sub: "Integration · Slack", mark: "slack" },
    ],
    subagents: [],
    mcp: [],
    skills: ["hubspot-sync"],
    secrets: [],
    permission: "Allow",
    automations: {
      scheduled: [],
      app: [{ name: "New form entry", when: "When the website form is sent" }],
    },
    channels: { slack: "connected" },
  },
  {
    id: "report",
    name: "Weekly client report",
    desc: "Pulls traffic and ad results and writes a short report per client",
    icon: "chart",
    color: ["#CA8A04", "#FBF4DF"],
    owner: "You",
    lastActive: "3 d ago",
    group: "This month",
    version: "v3",
    savedAgo: "1 w ago",
    model: {
      name: "Claude Sonnet 5.5",
      id: "claude-sonnet-5-5",
      harness: "Claude Code",
      provider: "anthropic",
    },
    instructions: {
      words: 30,
      text: "You write a short weekly report for each client from their site traffic and ad results.",
      md: [],
    },
    integrations: [],
    subagents: [],
    mcp: [],
    skills: [],
    secrets: [],
    permission: "Ask",
    automations: { scheduled: [], app: [] },
    channels: {},
  },
  {
    id: "invoice",
    name: "Invoice chaser",
    desc: "Follows up on unpaid invoices by email",
    icon: "receipt",
    color: ["#D61010", "#FBE7E7"],
    owner: "Lena Fischer",
    lastActive: "2 w ago",
    group: "Older",
    version: "v2",
    savedAgo: "3 w ago",
    model: {
      name: "GPT-5.5 mini",
      id: "gpt-5.5-mini",
      harness: "Pi",
      provider: "openai",
    },
    instructions: {
      words: 22,
      text: "You follow up on unpaid invoices by email, politely and in plain words.",
      md: [],
    },
    integrations: [],
    subagents: [],
    mcp: [],
    skills: [],
    secrets: [],
    permission: "Ask",
    automations: { scheduled: [], app: [] },
    channels: {},
  },
];

export const agentById = (id) => AGENTS.find((a) => a.id === id) ?? AGENTS[0];

// Sessions, newest first per agent. status: idle | live | waiting | auto (automation run).
export const SESSIONS = [
  {
    id: "charged",
    agent: "support",
    title: "Charged twice for March",
    status: "idle",
    day: "Today",
    user: 'Triage this ticket: "I was charged twice for March. Order 48213. Please fix this today."',
    worked: "Worked for 5 s",
    steps: [
      "Read ticket #48213 in Zendesk",
      "Looked up order 48213",
      "Labeled the ticket billing and high",
    ],
    reply: [
      "Urgency: high. Category: billing.",
      "The customer was charged twice for the March invoice. I labeled the ticket billing and high, and assigned it to the Finance queue.",
      'Draft reply: "Hi Dana, thank you for telling us. You were charged twice for March. We have started the refund for the second charge. You will see it in 3 to 5 business days."',
    ],
  },
  {
    id: "safari",
    agent: "support",
    title: "Login fails on Safari",
    status: "waiting",
    day: "Today",
    user: 'Triage this ticket: "I cannot log in on Safari since this morning. Chrome works."',
    worked: "Worked for 4 s",
    steps: [
      "Read ticket #48219 in Zendesk",
      "Found 3 similar tickets this week",
    ],
    reply: [
      "Urgency: medium. Category: bug.",
      "Login fails on Safari since this morning. Three other customers reported the same bug this week. I labeled the ticket bug and medium.",
      "I drafted a reply. Approve it before I add it to the ticket.",
    ],
  },
  {
    id: "invoicecopy",
    agent: "support",
    title: "Invoice copy for March",
    status: "idle",
    day: "Yesterday",
    user: 'Triage this ticket: "Can you send me a copy of the March invoice?"',
    worked: "Worked for 3 s",
    steps: ["Read ticket #48190 in Zendesk"],
    reply: [
      "Urgency: low. Category: billing.",
      'Draft reply: "Hi Tom, here is your March invoice. You can also download it from Billing at any time."',
    ],
  },
  {
    id: "csv",
    agent: "support",
    title: "Export to CSV is empty",
    status: "idle",
    day: "Earlier",
    user: 'Triage this ticket: "The CSV export is empty for the last 30 days."',
    worked: "Worked for 6 s",
    steps: ["Read ticket #48102 in Zendesk", "Checked the status page"],
    reply: [
      "Urgency: medium. Category: bug.",
      "The export bug is known and has a fix in review. I labeled the ticket and linked it to the bug.",
    ],
  },
  {
    id: "pricing",
    agent: "seo",
    title: "Brief for the pricing page",
    status: "live",
    day: "Today",
    user: "Write an SEO brief for our pricing page.",
    worked: "Worked for 41 s",
    steps: [
      "Read 90 days of Search Console data",
      "Compared the top 5 results for agency pricing",
      "Saved the brief in Notion",
    ],
    reply: [
      "The brief targets agency pricing and AI agency pricing. Together they get about 2,400 searches a month.",
      "I saved the brief in Notion under SEO briefs. It has the title, the outline, 6 questions to answer and 2 internal links.",
    ],
  },
  {
    id: "keywords",
    agent: "seo",
    title: "Keywords for the March blog",
    status: "idle",
    day: "Yesterday",
    user: "Which keywords should the March blog posts target?",
    worked: "Worked for 28 s",
    steps: [
      "Read 90 days of Search Console data",
      "Grouped 214 queries by topic",
    ],
    reply: [
      "Three topics stand out: client reporting, AI for agencies and proposal templates.",
      "I added the list with search volume and current rank to Notion.",
    ],
  },
  {
    id: "onboarding",
    agent: "seo",
    title: "Refresh the onboarding guide",
    status: "idle",
    day: "Earlier",
    user: "The onboarding guide lost traffic. What should we change?",
    worked: "Worked for 33 s",
    steps: [
      "Compared clicks for the last 2 quarters",
      "Read the top 3 results",
    ],
    reply: [
      "The guide lost 38% of its clicks since a competitor published a newer one.",
      "Add a section on the first week and update the screenshots. I wrote the outline in Notion.",
    ],
  },
  {
    id: "webleads",
    agent: "lead",
    title: "New leads from the website",
    status: "auto",
    day: "Today",
    user: "Qualify the 3 new leads from the website form and add them to HubSpot.",
    worked: "Worked for 38 s",
    steps: [
      "Read the 3 new form entries",
      "Researched the 3 companies on the web",
      "Added 3 leads to HubSpot",
    ],
    reply: [
      "I scored the 3 new leads against your criteria. Northwind is a hot lead with 320 seats.",
      "I added all three to HubSpot with their scores and posted the hot lead in #sales.",
    ],
  },
  {
    id: "webinar",
    agent: "lead",
    title: "Score the webinar list",
    status: "idle",
    day: "Earlier",
    user: "Score the 48 people who joined the webinar.",
    worked: "Worked for 1 min",
    steps: ["Read the webinar list", "Scored 48 contacts"],
    reply: [
      "9 contacts are a good fit. I added them to HubSpot with the tag webinar-nov.",
    ],
  },
];

export const sessionsOf = (agentId) =>
  SESSIONS.filter((s) => s.agent === agentId);
// "new" is a blank session that has no messages yet (New session in the sidebars).
export const NEW_SESSION = {
  id: "new",
  title: "Untitled session",
  status: "idle",
  isNew: true,
};
export const sessionById = (id) =>
  id === "new"
    ? NEW_SESSION
    : (SESSIONS.find((s) => s.id === id) ?? SESSIONS[0]);

// Builder chats. "safari" holds the proposed change from the builder design (S03).
export const BUILDER_CHATS = [
  {
    id: "safari",
    title: "Urgency of the Safari ticket",
    age: "2h",
    agent: "support",
  },
  {
    id: "billing",
    title: "Shorter replies for billing tickets",
    age: "3d",
    agent: "support",
    q: "Make the replies for billing tickets shorter.",
    a: [
      "I changed the reply rule. Billing replies now have at most 3 sentences.",
      "You approved the change. It is saved as v4.",
    ],
  },
  {
    id: "refund",
    title: "Add the refund skill",
    age: "8d",
    agent: "support",
    q: "Can the agent check if a charge can be refunded?",
    a: [
      "I added the refund-policy skill. It reads the policy and the charge, then says if a refund is possible.",
      "You approved the change. It is saved as v3.",
    ],
  },
  {
    id: "label",
    title: "Why the Safari ticket was not labeled",
    age: "15d",
    agent: "support",
    q: "Why was the Safari ticket not labeled?",
    a: [
      "Zendesk returned an error when the agent added the label. The connection had expired.",
      "I asked you to reconnect Zendesk. The next run labeled the ticket.",
    ],
  },
  {
    id: "area",
    title: "Label tickets by product area",
    age: "22d",
    agent: "support",
    q: "Also label each ticket with its product area.",
    a: [
      "I added 5 product areas to the instructions: billing, login, export, reports and API.",
      "You approved the change. It is saved as v2.",
    ],
  },
  {
    id: "test",
    title: "Test with last week's tickets",
    age: "29d",
    agent: "support",
    q: "Test the agent with last week's tickets.",
    a: [
      "I ran 20 tickets from last week. 18 got the same urgency as your team gave them.",
      "Both misses were login bugs. I suggest a rule for bugs that many customers report.",
    ],
  },
  {
    id: "slack",
    title: "Connect Slack for urgent tickets",
    age: "41d",
    agent: "support",
    q: "Post urgent tickets in Slack.",
    a: [
      "I connected Slack. Urgent tickets now go to #support-urgent with a link to Zendesk.",
    ],
  },
  {
    id: "daily",
    title: "Daily summary at 09:00",
    age: "48d",
    agent: "support",
    q: "Send me a summary of open tickets every morning.",
    a: [
      "I added an automation. Every day at 09:00 the agent posts the open tickets by urgency.",
    ],
  },
  {
    id: "create",
    title: "Create the Support triage agent",
    age: "70d",
    agent: "support",
    q: "Build an agent that sorts our Zendesk tickets and drafts replies.",
    a: [
      "I created Support triage with Zendesk and the ticket-triage skill.",
      "Test it with a real ticket before you turn on the automation.",
    ],
  },
];

export const SKILLS = [
  {
    id: "ticket-triage",
    title: "ticket-triage",
    desc: "Decides the urgency and category of a support ticket",
    source: "This project",
    usedBy: 1,
    updated: "2 d ago",
    files: ["SKILL.md", "references/urgency-rules.md"],
    body: "# Ticket triage\n\nUse this skill for every new support ticket.\n\n1. Read the ticket and the customer's last 3 tickets.\n2. Pick one category: billing, login, export, reports or API.\n3. Pick the urgency with references/urgency-rules.md.\n4. Add both labels in Zendesk.",
  },
  {
    id: "refund-policy",
    title: "refund-policy",
    desc: "Checks if a charge can be refunded",
    source: "This project",
    usedBy: 1,
    updated: "8 d ago",
    files: [
      "SKILL.md",
      "references/refund-policy.md",
      "scripts/lookup_charge.py",
    ],
    body: "# Refund policy\n\nUse this skill when a customer asks for money back.\n\n1. Look up the charge with scripts/lookup_charge.py.\n2. Check the rules in references/refund-policy.md.\n3. Say if a refund is possible and why.",
  },
  {
    id: "seo-brief-writer",
    title: "seo-brief-writer",
    desc: "Writes an SEO brief from a keyword and the top results",
    source: "This project",
    usedBy: 1,
    updated: "1 h ago",
    files: ["SKILL.md", "templates/brief.md"],
    body: "# SEO brief writer\n\nUse this skill when you need a brief for a new post.\n\n1. Read the top 5 results for the keyword.\n2. List the questions they answer.\n3. Fill templates/brief.md.",
  },
  {
    id: "brand-voice",
    title: "brand-voice",
    desc: "How Acme Agency writes: short, warm and concrete",
    source: "Shared",
    usedBy: 3,
    updated: "2 w ago",
    files: ["SKILL.md"],
    body: "# Brand voice\n\nWrite short sentences. Use the words our clients use. Give one example for each claim.",
  },
  {
    id: "hubspot-sync",
    title: "hubspot-sync",
    desc: "Adds or updates a contact and its deal in HubSpot",
    source: "This project",
    usedBy: 1,
    updated: "1 mo ago",
    files: ["SKILL.md"],
    body: "# HubSpot sync\n\nFind the contact by email before you create one. Add the score to the deal.",
  },
];

export const FILES = [
  { name: "agent-files", kind: "folder", meta: "4 items" },
  { name: "triage-notes.md", kind: "MD", tone: "info", meta: "1.2 KB" },
  { name: "tickets-march.csv", kind: "CSV", tone: "success", meta: "48 KB" },
  { name: "refund-policy.pdf", kind: "PDF", tone: "error", meta: "212 KB" },
  { name: "reply-draft.md", kind: "MD", tone: "info", meta: "640 B" },
  { name: "summary.json", kind: "JSON", tone: "warning", meta: "2.1 KB" },
];

export const FILE_BODIES = {
  "reply-draft.md": [
    ["h", "Reply to Dana, order 48213"],
    ["p", "Hi Dana,"],
    [
      "p",
      "Thank you for telling us. You were charged twice for March. We have started the refund for the second charge. You will see it in 3 to 5 business days.",
    ],
    [
      "p",
      "If you do not see it by Friday, reply to this email and we will check it with the bank.",
    ],
    ["p", "Best regards,\nThe Acme support team"],
  ],
  "triage-notes.md": [
    ["h", "Triage notes"],
    ["p", "Billing problems are always high."],
    ["p", "A bug is medium unless money is involved."],
    ["p", "Check the status page before you label an export bug."],
  ],
  "tickets-march.csv": [
    [
      "code",
      "id,subject,urgency,category\n48213,Charged twice for March,high,billing\n48219,Login fails on Safari,medium,bug\n48190,Invoice copy for March,low,billing\n48102,Export to CSV is empty,medium,bug",
    ],
  ],
  "summary.json": [
    ["code", '{\n  "open": 14,\n  "high": 3,\n  "medium": 7,\n  "low": 4\n}'],
  ],
  "refund-policy.pdf": [
    ["h", "Refund policy"],
    [
      "p",
      "A double charge is refunded at once. Other refunds need a reason and are possible for 30 days.",
    ],
  ],
};

export const MEMBERS = [
  {
    name: "Maya Brooks",
    email: "maya@acme-agency.com",
    role: "Owner",
    status: "Active",
    added: "Mar 3, 2026",
    you: true,
  },
  {
    name: "Sam Ortiz",
    email: "sam@acme-agency.com",
    role: "Admin",
    status: "Active",
    added: "Mar 3, 2026",
  },
  {
    name: "Lena Fischer",
    email: "lena@acme-agency.com",
    role: "Editor",
    status: "Active",
    added: "Jun 12, 2026",
  },
  {
    name: "Jonas Weber",
    email: "jonas@acme-agency.com",
    role: "Viewer",
    status: "Pending",
    added: "Nov 21, 2026",
  },
];

export const ROLES = [
  "Owner",
  "Admin",
  "Developer",
  "Editor",
  "Annotator",
  "Viewer",
];

// Analytics, last 7 days (Nov 19 to Nov 25).
export const DAYS = [
  "Nov 19",
  "Nov 20",
  "Nov 21",
  "Nov 22",
  "Nov 23",
  "Nov 24",
  "Nov 25",
];
export const RANGES = {
  "Last 24 hours": { scale: 0.16, label: "Last 24 hours" },
  "Last 7 days": { scale: 1, label: "Last 7 days" },
  "Last 30 days": { scale: 4.1, label: "Last 30 days" },
  "Last 90 days": { scale: 12.6, label: "Last 90 days" },
};
export const SERIES = {
  cost: [15.2, 19.6, 7.8, 9.9, 13.1, 5.1, 4.6],
  runs: [15, 9, 6, 8, 12, 6, 6],
  failed: [0, 1, 0, 0, 1, 0, 0],
  tokens: {
    input: [0.3, 0.3, 0.2, 0.4, 0.5, 0.2, 0.2],
    output: [0.2, 0.2, 0.1, 0.2, 0.3, 0.1, 0.1],
    cacheRead: [17.4, 17.6, 6.4, 12.4, 22.1, 6.6, 6.0],
    cacheWrite: [0.8, 1.3, 0.4, 0.4, 1.1, 0.4, 0.4],
  },
};
export const FAILURES = [
  {
    agent: "Support triage",
    reason: "Zendesk connection expired",
    failed: 1,
    rate: "2.6%",
  },
  {
    agent: "Lead Qualifier",
    reason: "HubSpot rate limit",
    failed: 1,
    rate: "6.7%",
  },
];

export const PROVIDERS = [
  {
    name: "OpenAI",
    sub: "GPT-5.5, GPT-5.5 mini and 14 more",
    status: "Active",
  },
  {
    name: "Anthropic",
    sub: "Claude Opus 5.5, Claude Sonnet 5.5 and 4 more",
    status: "Active",
  },
  { name: "Google Gemini", sub: "Gemini 3 Pro, Gemini 3 Flash", status: null },
  { name: "Mistral", sub: "Mistral Large, Mistral Medium", status: null },
  { name: "OpenRouter", sub: "One key for 300+ models", status: null },
];
export const CLOUDS = [
  { name: "Azure OpenAI", sub: "Your Azure deployment", status: null },
  { name: "AWS Bedrock", sub: "Your AWS account", status: null },
  { name: "Vertex AI", sub: "Your Google Cloud project", status: null },
];

export const API_KEYS = [
  {
    key: "ag-k2Fq…9xT1",
    created: "Oct 2, 2026",
    expires: "Never",
    used: "2 h ago",
  },
  {
    key: "ag-Lm7c…4pQe",
    created: "Aug 18, 2026",
    expires: "Feb 18, 2027",
    used: "Never used",
  },
];

// Automations (features/automations on main): schedules and app events, always in UTC.
export const AUTOMATIONS = [
  {
    id: "daily-summary",
    name: "Daily summary",
    kind: "schedule",
    when: "Daily at 09:00 UTC",
    agent: "support",
    status: "Working",
    last: "2h ago",
    runs: "24 runs in 30 days",
    next: "Wed, Nov 26, 09:00 UTC · in 15 hours",
    lastRun: "Today 09:00",
    lastOk: true,
    edited: "edited 3d ago",
    instruction:
      "Post the open tickets by urgency in #support-urgent. Start with the high ones.",
  },
  {
    id: "new-ticket",
    name: "New Zendesk ticket",
    kind: "event",
    when: "When ticket created in Zendesk",
    agent: "support",
    status: "Working",
    last: "12m ago",
    runs: "183 runs in 30 days",
    lastRun: "Today 17:48",
    lastOk: true,
    edited: "edited 2w ago",
    instruction:
      "Triage the new ticket: pick its urgency and category, label it, and draft a first reply.",
  },
  {
    id: "keyword-report",
    name: "Weekly keyword report",
    kind: "schedule",
    when: "Weekly on Monday at 08:00 UTC",
    agent: "seo",
    status: "Working",
    last: "1d ago",
    runs: "4 runs in 30 days",
    next: "Mon, Dec 1, 08:00 UTC · in 6 days",
    lastRun: "Mon 08:00",
    lastOk: true,
    edited: "edited just now",
    instruction:
      "Read last week's Search Console data and write a short report on the keywords that moved.",
  },
  {
    id: "form-entry",
    name: "New form entry",
    kind: "event",
    when: "When form submitted in HubSpot",
    agent: "lead",
    status: "Paused",
    last: "3d ago",
    runs: "41 runs in 30 days",
    lastRun: "Sat 11:02",
    lastOk: false,
    edited: "edited 3d ago",
    instruction:
      "Score the new lead against our criteria and add it to HubSpot. Post hot leads in #sales.",
  },
];
// Run history for each automation, newest first. The first run matches the
// automation's lastRun and lastOk, so the detail page and the history agree.
export const RUNS = {
  "daily-summary": {
    ok: "Done. I posted 14 open tickets in #support-urgent: 3 high, 7 medium and 4 low.",
    fail: "The run stopped before it finished: the Zendesk connection had expired.",
    days: [
      [
        "Today",
        [
          ["Scheduled run", "09:00", "ok", "took 1m 12s"],
          ["Test run", "08:41", "ok", "took 58s"],
        ],
      ],
      ["Yesterday", [["Scheduled run", "09:00", "fail", "did not finish"]]],
      ["Sun", [["Scheduled run", "09:00", "ok", "took 49s"]]],
    ],
  },
  "new-ticket": {
    ok: "Done. I set the ticket to high urgency, labeled it Billing, and drafted a first reply.",
    fail: "The run stopped before it finished: the Zendesk connection had expired.",
    days: [
      [
        "Today",
        [
          ["Ticket created", "17:48", "ok", "took 41s"],
          ["Ticket created", "16:05", "ok", "took 37s"],
        ],
      ],
      [
        "Yesterday",
        [
          ["Ticket created", "14:22", "fail", "did not finish"],
          ["Ticket created", "10:31", "ok", "took 44s"],
        ],
      ],
    ],
  },
  "keyword-report": {
    ok: "Done. 12 keywords moved last week. I wrote the report and shared it in #seo.",
    fail: "The run stopped before it finished: the Search Console connection had expired.",
    days: [
      ["Mon", [["Scheduled run", "08:00", "ok", "took 2m 31s"]]],
      ["Nov 17", [["Scheduled run", "08:00", "ok", "took 2m 12s"]]],
      ["Nov 10", [["Scheduled run", "08:00", "ok", "took 2m 40s"]]],
      ["Nov 3", [["Scheduled run", "08:00", "fail", "did not finish"]]],
    ],
  },
  "form-entry": {
    ok: "Done. I scored the lead as hot, added it to HubSpot, and posted it in #sales.",
    fail: "The run stopped before it finished: the HubSpot connection had expired.",
    days: [
      [
        "Sat",
        [
          ["Form submitted", "11:02", "fail", "did not finish"],
          ["Form submitted", "09:17", "ok", "took 29s"],
        ],
      ],
      ["Fri", [["Form submitted", "16:40", "ok", "took 33s"]]],
    ],
  },
};
