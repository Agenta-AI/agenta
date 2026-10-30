Naming and consistency

Intent

Help a small team keep a large product predictable. A reader who knows one part of Agenta
should be able to guess the names, folders, routes and shapes of the next part. Each concept
has one name, in every layer. Each kind of item looks and behaves like its siblings. Each
rule lives in one place and holds on every path.

A naming problem is rarely only about a word. Two names for one concept means two places
that a change must find. One word with two meanings means a reader who guesses wrong. A name
that is hard to choose often means the concept mixes two things. Look at the design behind
the name before you suggest a rename.

What to weigh

Judge each mismatch by who meets it and what it costs. A mismatch on new surface is cheap to
fix now. A mismatch on a shipped contract (stored JSON, a column, a public route, an SDK
field) costs a migration; prefer to record it as an exception and stop it from spreading.
A mismatch that makes a caller do the wrong thing is worse than one that only slows a
reader.

Project conventions decide. Generic standards (Google AIP, textbook patterns) fill gaps
only. A pattern name, a folder layout, a line count or a missing class is not evidence by
itself. Do not split for length, add extension points for imagined consumers, merge code
that only looks similar, or suggest a framework or a new service without a failed
requirement.

Consistency serves the reader. Do not spread a known bad pattern to stay consistent; name
it and stop it at the new surface. Two contexts may use one word with two meanings when an
explicit mapping joins them. Inside one context, they may not.

Make the finding worth acting on

Cite the rule (a glossary term, a convention row, a template section, a check in
`references/checks.md`) and its strength. Show the evidence: the exact names and where they
are. Give the smallest fix, and say whether it is a rename, a mapping in one place, or a
recorded exception. Say what is already right, so the author keeps it.
