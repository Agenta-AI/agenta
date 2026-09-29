# Job Hunt Research Assistant setup

Purpose: finds current roles that match your profile, checks that postings are genuinely open, researches employers, and saves evidence-backed fit notes and next steps.

## Before your first search

1. Add the Tavily MCP server in Tools. The agent calls Tavily search, extraction, and research tools; configure a server named `mcp_tavily_com` that exposes those tools. Use your own endpoint and credentials. This template does not include a URL or credentials.
2. Replace the placeholders in `job-hunt/profile.md` with your target roles, location, experience, skills, industry preferences, and salary/level preference, or ask the agent to onboard you. Share your CV/resume text or upload it during onboarding; it will be saved in that profile for future matching. LinkedIn/contact details are optional and used only for outreach drafts.
3. Review the optional “Daily job search” automation before enabling it. It is set to 07:00 UTC; confirm the schedule, your timezone, and that your profile is complete. Loading the template does not activate it.

First-use check: ask, “Find current mid-level data engineer roles in Amsterdam, Netherlands that match my profile.” A good answer verifies location and active status, provides canonical links and evidence-backed fit notes, identifies unknowns honestly, and saves a dated report under `job-hunt/reports/`.
