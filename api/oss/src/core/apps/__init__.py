"""Agent HTML apps: the platform side of ``apps/<slug>/`` folders in an agent drive.

``service`` copies starters into a mount and validates ``app.json``; ``skill`` assembles the
``agenta-apps`` skill that teaches the procedure; ``handlers`` exposes both as reserved
``tools.agenta.*`` platform ops. The bridge contract lives in
``docs/design/agent-html-apps/contracts.md``.
"""
