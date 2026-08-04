# Live QA script — file drawer edit mode

Manual walkthrough for a human, run against a deployed stack with a live agent session.
Every step states the expected result. Anything that does not match is a bug — record it
with the file type and step number.

## 0. Setup

1. Deploy the branch (`feat/file-drawer-edit-mode`) and open an agent session in the chat
   view.
2. Create the fixture files locally:

   ```bash
   mkdir -p /tmp/qa-edit && cd /tmp/qa-edit
   printf 'hello world\nsecond line\n'                     > notes.txt
   printf 'name,role\nada,eng\ngrace,eng\n'                > people.csv
   printf '# Title\n\nSome *markdown* body.\n'             > readme.md
   printf 'API_KEY=abc123\nDEBUG=false\n'                  > .env
   printf '{\n  "mode": "fast",\n  "retries": 2\n}\n'      > config.json
   head -c 2000000 /dev/urandom | base64 | head -c 1700000 > huge.txt   # ~1.7 MB, over the cap
   # any small PNG/JPG works for the non-editable case
   ```
3. Open the session's **Files** drawer and drag all seven files into it. Wait until each
   appears in the tree with a size.

   **Expected:** all seven upload; the drawer header shows the drive breadcrumb; no error
   toasts.

Reference for the whole run:

- The **Edit** button (pencil icon) sits in the drawer header's right-hand action cluster,
  next to Download and the ⋯ overflow.
- While editing, the header's action cluster gains **Cancel** and **Save**; an "Editing"
  bar replaces the toolbar above the content.
- **Save** is disabled until the buffer is dirty. Keyboard, with focus inside the drawer:
  `Cmd/Ctrl+E` enters edit mode, `Cmd/Ctrl+S` saves, `Esc` cancels.
- The size cap is 1.5 MB (1,572,864 bytes).

---

## 1. `.txt` — `notes.txt`

1. Click `notes.txt` in the tree.
   **Expected:** the right pane shows the plain-text body `hello world / second line`. The
   header shows the file name and an enabled **Edit** button.
2. Click **Edit**.
   **Expected:** the content pane swaps to an editor with the file's text and a focused
   caret. The toolbar row is replaced by an "Editing" bar showing a `Plain text` chip
   (hover it: "Syntax highlighting only") and "Esc to cancel" on the right. The header now
   shows **Cancel** and a **disabled** **Save**. No "Unsaved" tag yet.
3. Append a line: `edited by qa`.
   **Expected:** an orange **Unsaved** tag appears next to the file name; **Save** becomes
   enabled.
4. Click **Save**.
   **Expected:** the button reads "Saving" briefly, then edit mode exits, the pane returns
   to the read-only text view showing the new content, and a green **Saved** tag shows
   next to the name. No error banner.
5. Select a different file, then click `notes.txt` again.
   **Expected:** the body still contains `edited by qa`.
6. Close the drawer, reopen it, and open `notes.txt`.
   **Expected:** `edited by qa` is still there — the change persisted to the mount, not
   just to the client cache.

---

## 2. `.csv` — `people.csv`

1. Click `people.csv`.
   **Expected:** the read view renders a **parsed table** (columns `name`, `role`), not raw
   text. **Edit** is enabled.
2. Click **Edit**.
   **Expected:** the table is replaced by a **raw source buffer** showing
   `name,role / ada,eng / grace,eng`. The "Editing" bar shows the `Plain text` chip (no
   Source/Preview toggle — that is markdown-only).
3. Add a row: `linus,eng`.
   **Expected:** **Unsaved** tag; **Save** enabled.
4. Click **Save**.
   **Expected:** edit mode exits and the pane returns to the **table** view, now with three
   data rows including `linus`. **Saved** tag shown.
5. Reopen the drawer and click `people.csv`.
   **Expected:** the table still has the `linus` row.

---

## 3. `.md` — `readme.md`

1. Click `readme.md`.
   **Expected:** rendered markdown (a heading and italic text). **Edit** enabled.
2. Click **Edit**.
   **Expected:** a **source** buffer showing the raw markdown. The "Editing" bar shows a
   **Source / Preview** segmented control with **Source** selected (this control appears
   only for markdown).
3. Change the heading to `# Title edited` and add a bullet list.
   **Expected:** **Unsaved** tag; **Save** enabled.
4. Click **Preview** in the Editing bar.
   **Expected:** the pane renders the *draft* markdown, including the edit you just made
   and the bullet list. The **Unsaved** tag stays; **Save** stays enabled.
5. Click **Source**.
   **Expected:** back to the raw buffer with the draft intact — nothing lost in the round
   trip.
6. Press `Cmd+S` (macOS) or `Ctrl+S`.
   **Expected:** the file saves without touching the mouse; edit mode exits; the pane shows
   the rendered markdown with your change; **Saved** tag.
7. Reopen the drawer and click `readme.md`.
   **Expected:** the rendered markdown still shows `Title edited` and the bullet list.

---

## 4. `.env` — `.env`

1. Turn on hidden/dotfiles in the drawer toolbar if `.env` is not visible, then click it.
   **Expected:** `.env` is treated as a **text** file — a plain-text body showing
   `API_KEY=abc123`, **not** a "download this file" card. **Edit** enabled.
   *(If `.env` renders as a download card, that is a bug: `resolveDriveFileKind` should map
   it to the `text` kind.)*
2. Click **Edit** and change `DEBUG=false` to `DEBUG=true`; add `REGION=eu`.
   **Expected:** **Unsaved** tag; **Save** enabled.
3. Click **Save**.
   **Expected:** saves cleanly; read view shows the new values; **Saved** tag.
4. Reopen the drawer and click `.env`.
   **Expected:** `DEBUG=true` and `REGION=eu` persisted.

---

## 5. `.json` — `config.json`

1. Click `config.json`.
   **Expected:** a syntax-highlighted JSON body. **Edit** enabled.
2. Click **Edit**.
   **Expected:** a code buffer with JSON highlighting; the "Editing" bar shows a **JSON**
   chip instead of `Plain text`; no Source/Preview toggle.
3. Change `"retries": 2` to `"retries": 5` and add `"timeout": 30`.
   **Expected:** **Unsaved** tag; **Save** enabled.
4. Click **Save**.
   **Expected:** saves; read view shows the new JSON. **Saved** tag.
   *(Note: invalid JSON is still saved — the editor does not validate or reformat. Saving
   deliberately broken JSON and getting the exact broken bytes back is correct behavior.)*
5. Reopen the drawer and click `config.json`.
   **Expected:** `"retries": 5` and `"timeout": 30` persisted, with whitespace exactly as
   you typed it.

---

## 6. The unsaved-changes guard

1. Open `notes.txt`, click **Edit**, and type something. Do **not** save.
   **Expected:** **Unsaved** tag visible.
2. Try to close the drawer (the drawer's close X, or click the mask outside it).
   **Expected:** the drawer does **not** close. A modal appears titled **"Discard unsaved
   changes?"** with body text naming the file ("`notes.txt` has changes that haven't been
   saved. Leaving now discards them.") and two buttons: **Keep editing** and **Discard**.
   The modal cannot be dismissed by clicking its mask or pressing Escape.
3. Click **Keep editing**.
   **Expected:** the modal closes, the drawer stays open, and your draft text is still in
   the editor, unchanged, still marked **Unsaved**.
4. Try to close the drawer again, and this time click **Discard**.
   **Expected:** the modal closes, the drawer closes, and the edit is dropped.
5. Reopen the drawer and click `notes.txt`.
   **Expected:** the discarded text is **not** there — the file still holds the content
   from walkthrough 1.
6. Repeat with the two other exits, expecting the same modal each time:
   - Edit, type, then click a **different file** in the tree. **Keep editing** must leave
     you on the original file with the draft intact; **Discard** must move you to the file
     you clicked.
   - Edit, type, then press **Esc** (Cancel). **Keep editing** keeps the draft; **Discard**
     returns the pane to the read-only view with the saved content.
7. Edit, type, then click **Cancel** with **no** changes made (clean buffer).
   **Expected:** no modal at all — a clean buffer exits straight to the read view.
8. Edit, type, then reload the browser tab (`Cmd/Ctrl+R`).
   **Expected:** the browser's own "Leave site? Changes you made may not be saved" prompt
   appears. Cancelling it keeps the draft; confirming it drops the draft (the file is
   unchanged on reload).

---

## 7. Over the size cap

1. Click `huge.txt` (~1.7 MB, over the 1.5 MB cap).
   **Expected:** the read view shows the existing over-cap card ("too large to preview" /
   download affordance) rather than inline text.
2. Look at the header action cluster.
   **Expected:** the **Edit** button is **rendered but disabled** (greyed out, not
   clickable).
3. Hover **Edit**.
   **Expected:** a tooltip reads **"Files larger than 1.5 MB can't be edited"**.
4. Click it anyway.
   **Expected:** nothing happens — no editor opens, no error.
5. While the file's content is still loading (open a fresh drawer and click a large-ish but
   under-cap text file immediately).
   **Expected:** **Edit** is briefly disabled with the tooltip "File content is still
   loading", then becomes enabled once the content and the directory listing have both
   arrived. It must never be enabled while content is still in flight.

---

## 8. A non-editable file (image)

1. Click the uploaded PNG/JPG.
   **Expected:** the image preview renders.
2. Look at the header action cluster.
   **Expected:** there is **no Edit button at all** — not a disabled one. Download and the
   ⋯ overflow are unaffected.
3. Repeat with any binary/PDF file you have handy.
   **Expected:** same — no Edit button.

---

## 9. Conflict handling (worth doing if you have an agent handy)

1. Open a text file, click **Edit**, and type a change. Leave the buffer open and dirty.
2. In the chat, ask the agent to modify that same file (e.g. "append a line to notes.txt").
   Wait for it to finish.
3. Click **Save**.
   **Expected:** the save is refused. A **warning banner** appears above the editor:
   "`<path>` changed while you were editing. Overwriting will replace that version." with
   **Reload from disk** and **Overwrite** buttons. Your draft is still in the editor.
4. Click **Reload from disk**.
   **Expected:** the buffer is replaced by the agent's version; your draft is gone; the
   banner clears.
5. Repeat steps 1-3, then click **Overwrite** instead.
   **Expected:** the save goes through, your version wins, edit mode exits, **Saved** tag.
6. Repeat step 1, then have the agent **delete** the file, then click **Save**.
   **Expected:** the banner reads "…was deleted while you were editing. Overwriting will
   recreate it." with only an **Overwrite** button (no Reload). Overwrite recreates the
   file with your content.

---

## 10. Save failure

1. Open a text file, click **Edit**, make a change.
2. Kill the network (devtools offline, or stop the API) and click **Save**.
   **Expected:** a **red banner** appears: "Couldn't save this file. `<reason>`. Your
   changes are still here." with a **Try again** button. The editor still holds every
   character you typed. Edit mode does **not** exit.
3. Restore the network and click **Try again**.
   **Expected:** the save succeeds, the banner clears, edit mode exits, **Saved** tag.

---

## 11. Themes

Run walkthrough 1 once in **light** theme and once in **dark** theme.

**Expected:** the editor, the "Editing" bar, the Unsaved/Saved tags, the guard modal, and
the warning/error banners all use theme colors — no white-on-white, no black-on-black, no
hard-coded panel that ignores the theme.

---

## Known limits (not bugs)

- **Read-only mounts:** there is no read-only flag on a mount today. Edit is gated on the
  same permission that gates upload, so any drive you can upload to shows Edit.
- **No side-by-side diff** on a conflict — only Reload / Overwrite.
- **No "Save and continue"** from the guard modal — Keep editing or Discard only.
- **No new / rename / delete** from the drawer. Editing existing files only.
- **Multi-dot config files** (`.env.local`, `foo.test.json`) may resolve to a different
  kind than their single-dot form; only the plain forms above are in scope.
- **Saving invalidates mount listings project-wide**, so an unrelated open drive may
  refetch its listing after a save. Expected for now.
