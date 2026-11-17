Slop

Intent

Find agent-generated slop in the change. Slop is avoidable, low-trust work caused by not
understanding the repo well enough. It creates extra bugs, review work, or maintenance work.
Judge the code, not who wrote it.

Judge the net change from the diff base to the head commit. Anything already at the diff base
is existing code, not the subject of the review. A branch that reached a clean result through
messy commits is not slop. A branch whose final diff is sloppy is slop, however tidy its
commits are.

First understand what the change is trying to do. Start with the changed files and the diff.
Read nearby code, repo instructions, and relevant tests to learn how the project works. Then
follow every workflow, route, state change, and rule the change touches from start to finish.

What to look for

Wrong assumptions about how the repo works. Broken flows. Skipped rules. Duplicate systems,
where the repo already had a simpler or established way to do the job. Needless complexity.
Work that is much larger than the result it delivers.

Weak tests. Read whether the tests prove the new behavior, or only match the code or the new
text. If a test's assertions do not match what the change claims to do, that is a finding.

Comment noise: comments that restate the next line, narrate what was changed and why, or
explain things the repo's conventions already make obvious.

Leftover debris from iteration: dead code, stale comments, unused helpers, and abandoned
approaches.

What not to raise

Be very critical, but do not raise the rating only because the diff is large or has several
small issues. Do not call necessary complexity slop. Do not charge the change for problems it
only sits next to.

Report each concrete slop problem as a finding anchored to the changed code. The rationale
names the two strongest reasons for the rating.
