# Prepare a GitHub publishing handoff

Read the recipient's publishing plan and confirm the requested scope. Use gh and git, not a connected GitHub integration for code work. Run gh auth status before the task; use the platform's secure credential setup if access is missing. Never ask for tokens in chat.

Do git/build work in /tmp and keep durable deliverables under agent-files/. Preserve approved copy and assets. Run relevant checks and inspect actual desktop and mobile previews. Before creating a PR, check status, diff and log against the base, push the branch with its upstream, then create the PR with the authorized content. Verify the remote branch and returned PR URL. Never merge, force-push the main branch, skip hooks or publish just to test access.
