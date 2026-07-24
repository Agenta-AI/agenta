# Context: what happens today and what we want

This file tells the story in plain language. It has no design in it. If you want the evidence
behind each claim, read [research.md](research.md). If you want the design, read
[design.md](design.md).

## What a person experiences today

A person opens the agent chat, attaches a photo, and types "what is this?" The chat box
accepts the photo. It shows a small preview. The message looks like it was sent with the
image. Then the agent answers as if no image were there. It saw only the words "what is this?"
and nothing else.

If the person attaches only the photo and no text at all, the turn fails outright with an
error that says there is no message to send.

Nothing warns the person that this will happen. The attachment looks accepted and then quietly
does nothing. That silent gap is the core problem.

There is a second, separate product we already ship: the prompt playground, which is not an
agent. That one does handle images and documents correctly. So agents are behind the rest of
the product, and the difference is invisible until you notice the agent ignoring your file.

## Why the file is lost

The file travels correctly almost the whole way. The chat box reads the file into memory. The
request carries it. Our SDK carries it. The runner, our service that drives the agent, receives
it intact. Then, at the very last step, the runner builds the message it hands to the harness
using only the text. It writes a single text block and drops everything else. The runner discards
every content block that is not text at that one call.

That last step was written when agents were text-only. It was never updated when attachments
were wired up through the rest of the path. So the path is complete except for the final step.

There is a related habit that makes this worse. On every new turn, the front end resends the
whole conversation so far, including every earlier attachment, in full, as raw bytes encoded as
text. A single five megabyte image becomes about seven megabytes of encoded text, and it is
sent again on every following turn. The same full bytes are also saved in the browser's local
storage and written into our tracing data. None of this is needed once a file is sent by
reference instead of by value, and all of it strains the browser, the network, and the traces.

## What we want to achieve

We want three outcomes, and all three at the same time.

**The model reads the file.** When a person shares an image, the model should see the image.
When they share audio, the model should hear it. When they share a document, the model should
read it. This is the part that is broken at the last runner step today.

**The agent can work on the file.** Beyond the model reading it, the file should be present on
the agent's own working directory so the agent's tools can open it, convert it, edit it, or run
a program over it. Whether the agent changes the file is the person's call in each
conversation, not a fixed rule.

**The file stays findable.** A person must always be able to return to exactly what they
shared, unchanged, and download it or see it again, even if the agent changes or deletes files in
its working directory. The thing you gave the agent is a durable record, not a temporary
scratch file that the agent might overwrite or delete.

## What "done" looks like

A person attaches a spreadsheet and asks the agent to chart the third column. The model reads
the spreadsheet. The agent opens the same spreadsheet with its tools, computes the chart, and
writes a new chart file. The person can still open the original spreadsheet, untouched, from the
files panel, and can also see the new chart the agent produced. If the person attaches a kind of
file the current model cannot handle, the chat box says so before the message is sent, instead
of accepting it and then ignoring it.

## The three hard constraints the design must respect

**The protocol to the harness is external.** The runner talks to the harness in ACP, a
standard we do not own. In ACP, for the model to actually perceive an image or audio, the bytes
must be delivered inline in the turn. There is no way to hand the model a link and trust it to
fetch the file. Storing the file in our object store does not remove this rule. It only removes
the need to resend the bytes in the saved conversation history. At the moment the runner hands
the turn to the harness, the bytes must be present. Details and sources are in
[research.md](research.md).

**We build on mounts, our existing file storage.** We already have a working file storage
system with per-session storage, access controls, upload, download, and listing. The design
reuses it rather than inventing new storage. What a mount is, what it can do, and who may call
it are laid out in [research.md](research.md).

**The harness adapters we run today deliver images, but not audio or documents.** The runner talks
to the model through two adapter packages (one for Claude, one for Pi). Reading their code shows that
both deliver an image to the model natively, but neither delivers native audio, and both fail to
deliver a document (one drops it, the other turns it into a byte count). So images can be shipped
now, while audio and documents are goals that wait on adapter work. The evidence is in
[research.md](research.md), section 4.

The full list of verified failure modes, with the exact files and lines, lives in
[research.md](research.md) under "Current state of the code."
