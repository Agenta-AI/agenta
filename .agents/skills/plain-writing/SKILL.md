---
name: plain-writing
description: >-
  Writes and edits prose in a plain and boring style: simple everyday words,
  complete sentences, no dashes, no jargon, and no analogies. Use when
  drafting or revising documents, Notion pages, reports, summaries, READMEs,
  emails, slides, commit messages, or PR descriptions, or when the user asks
  to simplify, clean up, tighten, reword, or make writing clearer. Use when
  the user invokes /plain-writing deslopify or asks to deslopify an agent
  response. Do not apply to code, only to the words around it.
license: MIT
---

# Plain writing

The plain writing skill captures how the user wants writing to read: plain,
boring, and easy to understand in one pass. Apply it by default when you write
for them.

There are four groups of rules: word choice and tone, sentences and paragraphs,
punctuation and formatting, and patterns to avoid. Each rule has a before and
after. After the rules comes the deslopify command.

## Word choice and tone

1. **Use simple, everyday words.** Don't pick a fancy synonym when a plain word
   works. Also avoid words AI tools overuse, e.g., "delve", "tapestry",
   "landscape", "robust", "leverage", and "reach".
   Before: We leverage the cache to unlock a more robust query experience.
   After: We use the cache to make repeated queries faster.

2. **No jargon.** Always use human-understandable language, the way two people
   talk to each other. Don't invent jargon or shorthand (that is, if a word or
   phrase is not in the Merriam Webster dictionary, don't use it). Use
   established technical terms only when they are most precise, and briefly
   define them when readers may not know them.
   Before: The score is a calibrated proxy for whether the property holds.
   After: The score estimates how likely the property is to hold.

3. **No puffery or empty emphasis.** Drop words that add emphasis but no
   information, e.g., "really", "real", "matters", "worth", "carries weight",
   "boasts", "a testament to", "pivotal", "renowned", and "quietly". State the
   actual point, or cut the sentence.
   Before: This result matters, and it carries weight for the design.
   After: The scores barely moved, so we can skip the model on most documents.

4. **Use consistent terminology and constrain your vocabulary.**
   Before: Upload the document. The file is parsed, and the record is saved.
   After: Upload the document. The document is parsed and saved.

5. **It's ok to use contractions.** They match everyday speech, so use them
   freely.
   Before: Do not worry, it is not going to overwrite your file.
   After: Don't worry, it's not going to overwrite your file.

6. **Do not invent hyphenated adjectives.** Avoid a phrase you make up by
   joining words with a hyphen to sound compact or clever. If you would not find
   it in a dictionary, don't use it. A common compound adjective that people
   already use is fine, e.g., "well-crafted".
   Before: We added a reveal-style colon to the output.
   After: We added a colon that shows the schema.

7. **Keep the writing boring, descriptive, and explanatory.** Do not use a
   catchy phrase, slogan, clever label, or wording meant to sound memorable.
   This rule applies everywhere; to headings, topic sentences, callouts,
   labels, summaries, and ordinary prose.
   Before: Legal requirements as a floor.
   After: Applicable legal constraints.
   Before: # The alignment loop
   After: # Iterative refinement using development disagreements

## Sentences and paragraphs

8. **Write complete sentences.** Each sentence should have a subject and a
   verb. Do not write fragments, and do not stitch unrelated ideas together with
   colons or semicolons. But it is ok to join closely related ideas with plain
   conjunctions, like "and", "because", or "so".
   Before: The agent polls the file and reacts to changes, and the team meets on
   Tuesdays.
   After: The agent polls the file and reacts to changes. The team meets on
   Tuesdays.

9. **When you present a workflow or sequence, walk through it in order.** Use
   "First", "Second", "Third", and give each step its own sentence so the
   reader can follow it, or break up steps with semicolons.
   Before: The groups the features were sorted into were the authors' own
   reading, the example posts were written by hand, and finer detail meant
   training extra small models and labeling again.
   After: First, the authors sorted the features into groups themselves, based on
   their own reading of the outputs. Second, they wrote the example posts by
   hand. Third, when they wanted finer detail, they trained another small
   model, and they labeled the posts again.

10. **Organize a paragraph as a topic sentence and then support.** Start each
   paragraph or section with a topic sentence that states the main point. Then,
   the next sentence should be a supporting example or fact, with an extra
   sentence about it if it needs one. Then, introduce more support with a plain
   connective like "For example", "Moreover", or "Or".
   Before: The parser skips files with no changes. The cache holds the previous
   output. Most renders are fast.
   After: Most renders are fast. For example, the parser skips files with no
   changes, so the server returns early. Moreover, the cache keeps the previous
   output, so a repeated render does no work.

11. **Never write three or more clauses in one sentence, or three or more
    example sentences in a row.** In ordinary prose, a sentence may have one or
    two related clauses. Do not pack three or more clauses into one prose
    sentence. If you need that many points, use a numbered First / Second / Third
    sequence under rule 9, or short bullet points when you are writing a
    brief. If list points are examples and you want to inline them, introduce
    with "e.g.". Also do not give three or more example sentences back to back
    to support the same point.
    Before: The parser reads the file, the validator checks the fields, and the
    writer saves the record.
    After: The parser reads the file, and the validator checks the fields. The
    writer then saves the record.

12. **Prefer long, explanatory sentences over short, punchy ones.** In ordinary
    prose, write the way people explain things out loud: longer sentences with
    commas, and the simplest way to say the point. Do not break one thought into
    a stack of short sentences, and don't write catchy short phrases. Short
    lines are fine only in labeled briefs, bullets, or a First / Second / Third
    sequence, e.g., "To do: validate recall on long queries."
    Before: The gate runs on every merge. It blocks regressions. Nobody
    bypasses it.
    After: The gate runs on every merge, and it blocks changes that fail a
    regression case. A regression cannot make it to production, unless someone
    deliberately overrides the check.
    Before: Search ranking now uses a scored model instead of heuristics. The
    change reduced p95 latency from 900 ms to 220 ms. We still need to validate
    recall on long queries.
    After: Search ranking now uses a scored model instead of heuristics, and
    p95 latency fell from 900 ms to 220 ms. To do: validate recall on long
    queries.

13. **Be precise and unambiguous, and cut unnecessary clauses.** Say exactly
    what changes, who does what, or by what mechanism. Prefer a concrete
    statement over an evocative abstraction, e.g., don't say things like
    "improvement stops being guesswork". Also drop trailing or side clauses
    that add no fact, e.g., "before we call the work done", "as we move
    forward", or "for the time being". Keep the sentence long when the content
    needs it, but do not pad it.
    Before: With trusted scores, improvement stops being guesswork.
    After: With trusted scores, you can measure whether each change helped,
    so you keep or revert each change based on the measured result.
    Before: We still need to validate recall on long queries before we call
    the work done.
    After: To do: validate recall on long queries.

14. **In chat, give context on the problem.** When you are chatting back and
    forth, write for a smart reader who does not have context on the problem,
    or who forgot it. Give context on the problem and on what was happening
    before. Then say what changed. Keep the setup short. Do not dump the whole
    history. Ignore this rule if you are writing an essay.
    Before: The exporter now waits on the reset header, and `dotnet test` is
    green.
    After: The Okta System Log exporter was rereading whole hours, so a retry
    could write the same event twice. It now waits using the response reset
    header, and the six acceptance tests pass.

## Punctuation and formatting

15. **No dashes or middle dots.** Do not use em dashes or en dashes, including in
    number ranges. Join clauses with a period or "and", and write ranges with
    "to". Do not use the middle dot (·) as a separator; use a comma, "and", or
    separate lines instead.
    Before: The build is fast — it finishes in 10 to 20 seconds.
    After: The build is fast. It finishes in 10 to 20 seconds.

16. **Don't use colons to join clauses in ordinary prose.** Do not use a colon
    to glue two clauses or to set up a point in essay-like writing. A colon is
    fine when you introduce a list. A colon is also fine as a short label in
    updates, briefs, status notes, and PR descriptions, e.g., "Summary:",
    "Changes:", or "Remaining work:".
    Before: Read for the schema: the feature fires.
    After: Read for the schema. The feature fires.
    Before (allowed in a PR or update): Summary: Replace em dashes in
    generated docs.
    After (same text is fine): Summary: Replace em dashes in generated docs.

17. **Use straight quotes, not curly quotes.**
    Before: The system logs each “event” as it happens.
    After: The system logs each "event" as it happens.

18. **Keep the formatting plain.** Use sentence case in headings. Do not use
    bold for decoration.
    Before: ## How To Install The Skill
    After: ## How to install the skill

19. **You can use lists, but do not overuse them.** Keep a list to three or
    four points, and nest extra points if you need more. When you are writing
    an essay, use lists and tables very sparingly.
    Before: Shipped this week:
    - dark mode
    - an invite link fix
    - a schema mismatch that blocked analytics export
    - renderer cleanup
    - copy edits
    - a scored ranking model
    - a p95 drop from 900 ms to 220 ms
    - untested recall on long queries
    After: Search ranking now uses a scored model, and p95 latency fell from
    900 ms to 220 ms. The old heuristic path is still in the repo as a
    fallback.
    - Shipped
      - Dark mode
      - Invite link fix
    - Still open
      - Test recall on long queries
      - Unblock analytics export

## Patterns to avoid

20. **Do not give inanimate things fake agency.** Do not write as if a system
    or object transforms, decides, or intends on its own when a person or
    process is the real actor. Ordinary factual verbs for tools and systems are
    fine, e.g., "The API returns JSON", "The job writes the file", or "The
    paper argues". Prefer a human or process subject when that is clearer.
    Before: The logs become searchable records, once the job finishes.
    After: You can search the logs, once the job finishes.

21. **No analogies or imagery.** Do not explain by comparing to something else,
    and do not use metaphor. Describe the actual thing in literal terms. Write
    in a boring way.
    Before: The feature index is like a card catalog that the optimizer can flip
    through.
    After: The feature index is a list of named features. The optimizer can look
    up which feature matches a request.

22. **Never use negative parallelism of the form "not just X, it is Y" or
    "not only X, but Y".** State what the thing is. A plain refusal or
    correction is fine, including a short quote of a customer's hype phrase
    when you replace it with a concrete fact.
    Before: It is not just a parser, it is a full toolchain.
    After: It is a parser and a formatter.
    Before: We do not describe the API as "enterprise-grade robust," because
    that phrase can mean different things.
    After: The API has a 99.9% monthly uptime SLO.

23. **Do not stack rhetorical questions.** AI writing often asks two or three
    rhetorical questions in a row to sound thoughtful. Don't do this. Just state
    the problem directly.
    Before: Does the tool keep the writer's voice? Does it make the argument
    stronger or weaker?
    After: We do not yet know whether the tool keeps the writer's voice, or
    whether it makes the argument stronger or weaker.

24. **Do not use vague demonstrative pronouns.** Do not use "This", "That",
    "These", or "Those", especially do not start a sentence with a demonstrative
    pronoun, and never begin a paragraph with a sentence that contains a
    demonstrative anywhere in it.
    Before: That context carries into the next turn.
    After: The agent applies the rules you saved on the next turn.

25. **Do not open with a count of things.** Never start by announcing how many
    points are coming, e.g., "Two cautions." or "Three things to keep in mind."
    State the first point directly. If you absolutely must present many things,
    use a bullet list instead.
    Before: Two cautions. First, the section can drift out of date. Second,
    it can balloon if every item gets a sentence.
    After: The section can drift out of date, because it duplicates facts
    that live elsewhere. It can also balloon if every item gets a sentence.

## The deslopify command

When the user says `/plain-writing deslopify`, rewrite the previous agent
response, or the text after the command, for a sharp CEO or technical reader
who has no project context. Return only the rewrite.

Start with the main conclusion, then cover the background, how it works, and
present all information logically and sequentially. Include technical details
the reader needs (standardize on existing well-known terminology, not new
terminology), and define unfamiliar terms.

Follow the plain-writing rules above.
