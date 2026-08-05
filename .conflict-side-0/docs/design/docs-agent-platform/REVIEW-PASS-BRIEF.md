# Review-pass brief: structure and headers

This brief encodes Mahmoud's PR review of the first draft (PR #5517, 2026-07-31). Every
writing agent in this pass follows it exactly. The three exemplar pages that already apply
it are `docs/docs/concepts/01-agents.mdx`, `docs/docs/concepts/02-instructions.mdx`, and
`docs/docs/concepts/03-skills.mdx`. Read all three before editing anything.

## The rules

1. **Delete every `{/* VIDEO: ... */}` comment.** All of them, everywhere.

2. **Every title and subtitle plainly says what its section says.** No cryptic, clever, or
   metaphorical headers. A reader must know what the section says from the header alone.
   - Bad: "An agent you build, not one you are given", "One budget: the context window",
     "The two toggles", "The rest of an agent".
   - Good: "When to use an agent", "The description decides when the agent loads a skill",
     "Skills and instructions differ in when they reach the model".

3. **One idea per paragraph, and the paragraph opens by stating it.** The first sentence
   summarizes or frames what the paragraph says; the rest develops it. Never start a
   paragraph mid-thought. Never bury the point in the middle. Break any paragraph that
   carries two ideas into two paragraphs.

4. **Concept pages start with concrete examples and keep referring back to them.**
   Comparisons (such as the ChatGPT comparison) clarify an argument that has already been
   made. They never carry the argument themselves.

5. **Facts are frozen.** This is a structure and wording pass. Do not invent UI labels,
   features, behaviors, or links. Every UI label in the result must already exist in the
   current text of the page. If restructuring would require a fact you do not have, keep
   the sentence that has the fact and restructure around it.

6. **Style** (Williams, plus repo rules): active voice; short sentences; the actor is the
   subject and the action is the verb; each sentence starts from what the reader already
   knows and ends on the new information; no em dashes; no marketing words
   ("powerful", "seamlessly", "simply"); 11th-grade English.

7. **Frontmatter stays valid.** Update `description` when the page's framing changed.
   Never add or change `slug` or `id`.

8. **Links.** The concepts section now has a page per topic: `/concepts/agents`,
   `/concepts/instructions` (new), `/concepts/skills`, and so on. URLs did not change with
   the file renumbering. When a sentence about instructions links to `/concepts/agents`,
   point it at `/concepts/instructions` instead.

9. **MDX mechanics.** Keep the ` ```mdx-code-block ` import fences, and keep a blank line
   after every closing fence. Keep `<Image ...>` blocks as they are unless the surrounding
   text moves, in which case they move with it.
