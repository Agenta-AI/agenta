# Codex review of `plan.md`

**Reviewer:** OpenAI Codex (gpt-5.6-sol, high reasoning effort), read-only sandbox.
**Date:** 2026-08-04 · **Worktree:** `/home/mahmoud/code/agenta-2-editmode` @ `2dae645c4c`
**Brief:** skeptical senior-frontend verification of `plan.md`, `research.md`, `CONTEXT.md`,
and `design/edit-mode-spec.html` against the real code. Every claim is cited `path:line`.

## Verdict

The plan is not implementable as written. The transport choice, most prop names, the six-value language mapping, `mtime`, CSV handling, and `.env` research are real; the central correctness claims are not. Markdown editing is not byte-preserving, saving does not make the proposed editor read-only, the buffer cannot distinguish a save snapshot from subsequent typing, the mount-id key is wrong for folded agent files, several drawer exits bypass the guard, and the conflict grace window creates both silent-overwrite and false-conflict races. This needs a smaller first PR and a rewritten controller/state design before implementation. `docs/design/file-drawer-edit-mode/plan.md:23-46` `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299` `web/oss/src/components/Drives/FilesDrawer.tsx:95-125` `docs/design/file-drawer-edit-mode/plan.md:489-503`

## 1. Is the editor reuse real, or invented?

### Blockers

#### 1.1 `state="readOnly"` does not make this editor read-only

The plan passes `disabled={phase === "saving"}` to the outer `EditorProvider`, but passes no `disabled` prop to `SharedEditor`; it passes only the visual `state="readOnly"`. `docs/design/file-drawer-edit-mode/plan.md:271-298`

`SharedEditor.state` changes container classes and cursor/background styling only. It is not forwarded as editor editability. `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:114-178`

`SharedEditor` separately forwards its `disabled` prop to the inner `Editor`; in the proposed call that value is `undefined`. `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:216-235`

The no-provider `Editor` then supplies its own `disabled` value to `EditorInner`. `web/packages/agenta-ui/src/Editor/Editor.tsx:1117-1149`

`EditorInner` defaults `disabled` to `false` and calls `editor.setEditable(!disabled)`. That inner effect can therefore re-enable the editor created by the disabled provider. `web/packages/agenta-ui/src/Editor/Editor.tsx:142-176` `web/packages/agenta-ui/src/Editor/Editor.tsx:455-457`

Failing sequence:

1. Edit a file.
2. Click Save.
3. The provider is rendered with `disabled=true`.
4. The inner editor receives `disabled=undefined`, defaults it to `false`, and calls `setEditable(true)`.
5. The user can keep typing during the write, contrary to the saving-state rule. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:476-483` `web/packages/agenta-ui/src/Editor/Editor.tsx:455-457`

The fix is not subtle: pass `disabled={phase === "saving"}` to `SharedEditor` as the chat precedent does. `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx:183-216`

#### 1.2 The proposed markdown editor is not a verbatim file editor

Research correction 5 is narrowly correct: `SET_MARKDOWN_VIEW(true)` means markdown source, and `false` means rich text. The plugin says so explicitly. `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:220-259` `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:279-289`

The plan’s stronger conclusion—“the buffer is always raw markdown source”—is false. On first switching from rich nodes to source, the plugin obtains the source by serializing the rich document unless its source cache is already reusable. `docs/design/file-drawer-edit-mode/plan.md:328-336` `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:151-168`

That first serialization can normalize the file before the user edits it. The command does not inject the original raw file string directly into a markdown `CodeNode`; it serializes the current rich-text tree. `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:151-160`

Rich-mode change emission is also explicitly lossy: it serializes the document and then calls `stripBackslashEscapes`. `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299`

`stripBackslashEscapes` removes every backslash that precedes another character, not merely a display-only escape. `web/packages/agenta-ui/src/Editor/plugins/markdown/utils/textCleanup.ts:146-177`

Failing sequence:

1. Open a markdown file containing a meaningful backslash escape.
2. The editor initially hydrates rich nodes.
3. The synchronizer dispatches `SET_MARKDOWN_VIEW(true)`.
4. The plugin serializes those nodes into source.
5. A subsequent rich-path emission strips backslashes.
6. Save writes bytes different from those originally read, even if the user changed an unrelated line. `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:151-168` `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299`

The chat editor is not a valid precedent for a byte-sensitive file editor. It edits a semantic chat-message value, and it deliberately uses the same `text` for both `initialValue` and `value`; it does not promise exact source preservation. `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx:158-186`

The first PR should use `codeOnly` for markdown source as well. Rendered markdown preview can remain a separate component, but the editable source must bypass the rich-text markdown transforms. `web/packages/agenta-ui/src/Editor/Editor.tsx:249-266` `web/oss/src/components/Drives/renderers.tsx:153-159`

#### 1.3 `initialValue={original}` plus `value={draft}` does not behave as described

All proposed `SharedEditor` props exist, but the behavioral explanation is wrong. `SharedEditor` chooses `value` over `initialValue` immediately for its controlled value. `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:71-80`

In code mode, the code plugin likewise chooses `value` over `initialValue` when constructing its initial content. `web/packages/agenta-ui/src/Editor/plugins/index.tsx:149-160`

Therefore `initialValue={original}` is not the mount-time source while `value={draft}` is the later controlled source in the clean two-phase sense claimed by the plan. `docs/design/file-drawer-edit-mode/plan.md:314-317`

For rich mode, controlled-value hydration is deferred while focused, which is another behavioral constraint the plan does not model. `web/packages/agenta-ui/src/Editor/Editor.tsx:741-755`

The buffer must own its exact original and draft independently of Lexical. Do not infer the save baseline from the editor’s `initialValue` behavior. `docs/design/file-drawer-edit-mode/plan.md:31-35` `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:71-105`

#### 1.4 The editor cannot implement “typed during save” with the proposed record

The design says saving is read-only, but also specifies that if the user has already typed again during the write, the state should return to dirty. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:485-492`

The record has no `savingDraft`, revision counter, request id, or buffer id. `docs/design/file-drawer-edit-mode/plan.md:23-46`

`editSaveSucceededAtom({size, mtime})` therefore cannot know which exact string was sent or whether the current draft changed after that snapshot. `docs/design/file-drawer-edit-mode/plan.md:135-148`

Comparing the current `draft` to `original` is insufficient because `original` is still the pre-save content. A successful save of a changed draft would remain dirty unless success updates `original`, but success cannot safely update it to the current draft if the current draft moved after the request began. `docs/design/file-drawer-edit-mode/plan.md:31-36` `docs/design/file-drawer-edit-mode/plan.md:136-148`

The state needs at least `saveRequest: {id, content}` or `savedRevision`, and the completion action must carry the buffer identity it belongs to. `docs/design/file-drawer-edit-mode/plan.md:125-141`

### Should-fix

#### 1.5 Prop audit: the props exist, but the exported provider type is stale

`EditorProvider` really accepts `codeOnly`, `language`, `enableTokens`, `showToolbar`, `disabled`, and `id` because its implementation is typed as `EditorProps & {children}`. `web/packages/agenta-ui/src/Editor/Editor.tsx:816-847`

The separately exported `EditorProviderProps` interface declares only HTML props, `children`, and `dimensions`. It does not describe the actual component. `web/packages/agenta-ui/src/Editor/types.d.ts:19-26`

This does not invalidate the JSX call because the component’s inferred signature is broader, but it is another documentation/type export inconsistency the plan failed to notice. `web/packages/agenta-ui/src/Editor/index.ts:51-52`

`SharedEditor` really accepts:

- `noProvider`. `web/packages/agenta-ui/src/SharedEditor/types.ts:55`
- `className`, inherited from `HTMLProps`. `web/packages/agenta-ui/src/SharedEditor/types.ts:20-23`
- `autoFocus`, also inherited from `HTMLProps` and destructured explicitly. `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:40-69`
- `id`, `footer`, `disableDebounce`, `initialValue`, and `value`. `web/packages/agenta-ui/src/SharedEditor/types.ts:27-37` `web/packages/agenta-ui/src/SharedEditor/types.ts:63-65`

There are no nonexistent props in the plan’s concrete `<EditorProvider>` or `<SharedEditor>` calls. The failures are semantic, not syntactic. `docs/design/file-drawer-edit-mode/plan.md:265-300`

#### 1.6 Research correction 3 is right

The README documents nonexistent `debounceDelay` and `containerVariant` props and gives an incomplete two-value `state` union. `web/packages/agenta-ui/src/SharedEditor/README.md:36-47`

The real props use `editorType: "border" | "borderless"` and a six-value `state`. `web/packages/agenta-ui/src/SharedEditor/types.ts:27-41`

The plan is right to distrust this README. `docs/design/file-drawer-edit-mode/research.md:79-91`

#### 1.7 `className="hidden"` is forwarded, but cursor preservation is asserted without an implementation

`SharedEditor` merges the caller’s `className` onto its outer DOM node, so the `hidden` class reaches the correct subtree. `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:114-167`

The editor remains mounted, and its `HistoryPlugin` remains mounted, so retaining the Lexical history object is plausible. `web/packages/agenta-ui/src/Editor/plugins/index.tsx:144-145`

There is no selection capture or restoration code around the preview toggle. `AutoFocusPlugin` runs as a mounted plugin, not as a view-transition restorer. `web/packages/agenta-ui/src/Editor/plugins/index.tsx:144-146`

The plan may claim that hiding avoids a remount. It cannot claim that cursor position survives the round trip without testing that exact toggle. `docs/design/file-drawer-edit-mode/plan.md:338-344` `docs/design/file-drawer-edit-mode/plan.md:622-626`

#### 1.8 `autoFocus` does not establish “cursor at the start”

The plan passes the boolean `autoFocus` and says that satisfies the requirement to place the cursor at the start. `docs/design/file-drawer-edit-mode/plan.md:320-321`

The editor merely mounts Lexical’s `AutoFocusPlugin`; the call contains no explicit start-selection command. `web/packages/agenta-ui/src/Editor/plugins/index.tsx:144-146`

The design explicitly requires the start, not merely focus somewhere in the editor. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:448-456`

#### 1.9 The synchronizer is not literally a direct copy

The chat synchronizer dispatches `SET_MARKDOWN_VIEW` in a layout effect and again in a request-animation-frame effect. `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx:79-104`

It does not directly set `markdownViewAtom`. The plugin sets that atom when it applies the node transformation. `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:130-168`

The plan says its synchronizer both copies the precedent and directly sets the atom. Those are different implementations. `docs/design/file-drawer-edit-mode/plan.md:328-334`

The atom is persistent `atomWithStorage`, keyed by editor id, so directly writing it also creates stored UI state with a path-derived id. `web/packages/agenta-ui/src/Editor/state/assets/atoms.ts:1-9`

#### 1.10 Research correction 4 and the mapper are right, with one broken test proposal

`CodeLanguage` really has exactly six values: `json`, `yaml`, `code`, `python`, `javascript`, and `typescript`. `web/packages/agenta-ui/src/Editor/plugins/code/types.ts:1-3`

`driveCodeLanguage` returns many other ids, including `tsx`, `jsx`, `shellscript`, `go`, `rust`, and `plaintext`. `web/oss/src/components/Drives/driveKinds.ts:24-61`

The plan’s mapper covers every current return by mapping known families and using `"code"` as the fallback. `docs/design/file-drawer-edit-mode/plan.md:349-364`

The proposed test cannot iterate “every key of `CODE_LANGS`” because `CODE_LANGS` is module-private, and the plan’s stated `driveKinds.ts` change exports only `TEXT_CAP`. `web/oss/src/components/Drives/driveKinds.ts:24-54` `docs/design/file-drawer-edit-mode/plan.md:167-170` `docs/design/file-drawer-edit-mode/plan.md:588-589`

Either test public extension cases or intentionally export a read-only language map. Do not add a test that cannot import its subject. `web/oss/src/components/Drives/driveKinds.ts:24-61`

#### 1.11 The diff imports exist, but `DiffView` is unsafe even for a malformed `.json`

`@agenta/ui/editor` exports `DiffView` and `computeTextDiffLines`. `web/packages/agenta-ui/src/Editor/index.ts:40-49`

`@agenta/ui/diff` directly exports the diff utility file. `web/packages/agenta-ui/package.json:15-22`

Both import paths proposed by the plan therefore exist. `docs/design/file-drawer-edit-mode/plan.md:366-374`

Research correction 2 is correct that the rendered `DiffView` supports JSON/YAML only: its prop type is restricted to those languages, and its diff extension parses with YAML or JSON5 before computing the diff. `web/packages/agenta-ui/src/Editor/DiffView.tsx:178-199` `web/packages/agenta-ui/src/Editor/plugins/code/extensions/diffHighlight.tsx:385-425`

On parse failure the extension logs the exception and does not construct diff content. `web/packages/agenta-ui/src/Editor/plugins/code/extensions/diffHighlight.tsx:526-529`

A file with a `.json` suffix is not guaranteed to contain valid JSON while the user or agent is editing it. The plan’s claim that JSON is “the one case `DiffView` handles correctly” is too broad. `docs/design/file-drawer-edit-mode/plan.md:368-374`

Use `computeTextDiffLines` for every file in this feature, including `.json`, because the product is comparing raw file contents rather than parsed data structures. `web/packages/agenta-ui/src/Editor/utils/diffUtils.ts:474-502`

#### 1.12 Rejecting `SimpleSharedEditor` is justified, but the reasoning is slightly inaccurate

`SimpleSharedEditor` detects JSON, YAML, and HTML from content and forces code mode for those detected values. `web/oss/src/components/EditorViews/SimpleSharedEditor/index.tsx:291-323`

It also owns format, copy, and minimize controls in its header. `web/oss/src/components/EditorViews/SimpleSharedEditor/index.tsx:185-287`

The plan is right that this is the wrong semantic wrapper for an extension-authoritative file editor. `docs/design/file-drawer-edit-mode/plan.md:248-258`

It does not “sniff on every render”; the checks are memoized against `value` and `initialValue`. `web/oss/src/components/EditorViews/SimpleSharedEditor/index.tsx:291-308`

That imprecision is a nit. The rejection itself is correct. `web/oss/src/components/EditorViews/SimpleSharedEditor/index.tsx:310-323`

## 2. Is the state machine complete and are the transitions sound?

### Blockers

#### 2.1 The state machine has no loaded-original state

`useDriveFileText` is asynchronous and returns `data: undefined` while pending. It also discards the query’s explicit error state and represents a failed read as non-pending undefined content. `web/oss/src/components/Drives/driveFileSource.tsx:63-84`

The current renderer distinguishes pending content from failed content. `web/oss/src/components/Drives/renderers.tsx:138-169`

The plan’s edit affordance uses only kind, listing size, and write capability. It does not require content to be loaded successfully. `docs/design/file-drawer-edit-mode/plan.md:518-529`

`openEditBufferAtom` requires a concrete `original: string`, but neither the record nor the hook signature represents “loading original” or “read failed.” `docs/design/file-drawer-edit-mode/plan.md:23-35` `docs/design/file-drawer-edit-mode/plan.md:127` `docs/design/file-drawer-edit-mode/plan.md:221-237`

Failing sequence:

1. Select a text file.
2. Click Edit before its content query completes, or after the query failed.
3. `useDriveFileText` supplies `undefined`.
4. `openEditBufferAtom` expects a string.
5. The implementation must either lie with `""`, crash/type-error, or silently edit an empty replacement. `web/oss/src/components/Drives/driveFileSource.tsx:63-84` `docs/design/file-drawer-edit-mode/plan.md:127`

Edit must be disabled until the raw content is a loaded string, with a distinct failure affordance. `web/oss/src/components/Drives/renderers.tsx:141-148`

#### 2.2 The family key is not the write mount id for folded agent files

Selection is keyed by the primary drive’s mount id. `web/oss/src/components/Drives/useDriveSelection.ts:18-35`

A displayed `agent-files/foo.md` path resolves to a different agent mount id and the mount-relative path `foo.md`. `web/oss/src/components/Drives/useSessionDrive.ts:188-194`

The proposed buffer family is keyed by `drive.mount?.id`, while the buffer’s `mountId` is the write target. Those values differ for agent files. `docs/design/file-drawer-edit-mode/plan.md:95-103` `docs/design/file-drawer-edit-mode/plan.md:125-128`

The state model needs separate names and responsibilities:

- `driveKey`: identifies the open drawer/controller slot.
- `targetMountId`: identifies the backend object store mount.
- `displayPath`: identifies the folded UI path.
- `targetPath`: identifies the mount-relative write path. `web/oss/src/components/Drives/useSessionDrive.ts:75-83` `web/oss/src/components/Drives/useSessionDrive.ts:188-194`

Calling all of these “mount id” and “path” guarantees a wrong query key or wrong write target later. `docs/design/file-drawer-edit-mode/plan.md:25-35`

#### 2.3 The action atoms do not identify which family instance to mutate

The family is parameterized by drive key, but the action signatures shown in the transition table contain no drive key except the target `mountId` in `openEditBufferAtom`. `docs/design/file-drawer-edit-mode/plan.md:95-103` `docs/design/file-drawer-edit-mode/plan.md:125-141`

`setEditDraftAtom(text)`, `startEditSaveAtom(abort)`, and the success/failure actions cannot know which `driveEditBufferAtomFamily(key)` instance to update without hidden global coupling or a second layer of atom families. `docs/design/file-drawer-edit-mode/plan.md:128-141`

The plan calls these concrete action atoms, not factory functions or per-key families. As specified, the state code cannot be written. `docs/design/file-drawer-edit-mode/plan.md:122-141`

#### 2.4 `openedAt` is referenced but never declared

`conflictFromActivity` compares `entry.at` with `buffer.openedAt`. `docs/design/file-drawer-edit-mode/plan.md:445-457`

`DriveEditBuffer` has no `openedAt` field. `docs/design/file-drawer-edit-mode/plan.md:23-46`

The tests also require an entry “timestamped before the buffer opened,” but the proposed fixture type cannot contain the needed timestamp. `docs/design/file-drawer-edit-mode/plan.md:595-596`

#### 2.5 Other fields and identities are missing

`editSaveSucceededAtom({size, mtime})` references an `mtime` result that the write response does not provide. `docs/design/file-drawer-edit-mode/plan.md:136` `docs/design/file-drawer-edit-mode/plan.md:484-498`

The record has no `size`, even though success receives `size` and the design requires size UI updates. `docs/design/file-drawer-edit-mode/plan.md:23-46` `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:485-492`

The record has no saved-request content, revision, request id, or buffer id, although the success transition depends on whether the draft moved during the request. `docs/design/file-drawer-edit-mode/plan.md:23-46` `docs/design/file-drawer-edit-mode/plan.md:146-148`

The record has no explicit “guard save continuation” state, although `resolveEditExitAtom("save")` must save and then run a specific interrupted action. `docs/design/file-drawer-edit-mode/plan.md:132-137`

The record has no “reload theirs in flight” state, although reload requires a content invalidation and asynchronous refetch before a new baseline exists. `docs/design/file-drawer-edit-mode/plan.md:507-510`

#### 2.6 “Pure action atoms” conflicts with executable exit intents

The plan says every action atom performs pure state manipulation with no I/O. `docs/design/file-drawer-edit-mode/plan.md:122-123`

The same table says exit actions “run the intent.” `docs/design/file-drawer-edit-mode/plan.md:130-137`

Only the filter intent contains a callable `run`; close, selection, cancel, and reload contain descriptions rather than executable continuations. `docs/design/file-drawer-edit-mode/plan.md:52-58`

A bare Jotai store cannot close a drawer or invoke the real selection callback from `{kind: "select"; path}` unless the atom imports app effects or stores callbacks. `docs/design/file-drawer-edit-mode/plan.md:52-58` `docs/design/file-drawer-edit-mode/plan.md:600-620`

Keep the reducer pure and let a controller interpret a returned continuation, or store an opaque intent and have the hook execute it after observing a successful terminal action. Do not pretend the atom both remains pure and performs UI effects. `web/AGENTS.md:184-209`

#### 2.7 `Reload theirs` clears the object it later tries to adopt into

The plan says reload routes through the dirty guard, which discards the buffer, then refetches and calls `adoptTheirsAtom`. `docs/design/file-drawer-edit-mode/plan.md:507-510`

The discard transition clears the buffer. `docs/design/file-drawer-edit-mode/plan.md:132-134`

`adoptTheirsAtom` is defined to operate on an open buffer. `docs/design/file-drawer-edit-mode/plan.md:140`

After discard there is no buffer to adopt into. The described transition is internally contradictory. `docs/design/file-drawer-edit-mode/plan.md:132-140`

Reload should either replace the existing buffer after confirmation or close edit mode and return to the normal viewer after invalidating content. It cannot do both. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:503-510`

#### 2.8 Saving cancellation has no coherent transition

The design says Cancel during saving aborts the request. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:476-483`

The record stores an `AbortController`, but the transition table has no `abortEditSaveAtom`, no saving-to-dirty transition for an abort, and no rule deciding whether Cancel closes, guards, or merely cancels the request. `docs/design/file-drawer-edit-mode/plan.md:43-45` `docs/design/file-drawer-edit-mode/plan.md:125-141`

The generic `requestEditExitAtom` rules discuss only clean versus dirty/banner states, not saving. `docs/design/file-drawer-edit-mode/plan.md:130-134`

The UI plan keeps Cancel enabled while saving, so this is reachable immediately. `docs/design/file-drawer-edit-mode/plan.md:196-201`

#### 2.9 Late save completion can mutate a replacement buffer

The family holds one nullable buffer per drive and deliberately survives drawer unmounts. `docs/design/file-drawer-edit-mode/plan.md:95-111`

A save completion carries no buffer id, file path, or request id—only size and mtime. `docs/design/file-drawer-edit-mode/plan.md:136`

Failing sequence:

1. Save file A.
2. Close or abort the drawer.
3. Reopen the same drive and edit file B.
4. File A’s request settles after file B replaced the family value.
5. `editSaveSucceededAtom({size, mtime})` applies to the current slot and can mark B saved or alter B’s baseline. `docs/design/file-drawer-edit-mode/plan.md:95-111` `docs/design/file-drawer-edit-mode/plan.md:125-141`

An `AbortController` does not prove the server did not write, and it does not make a previously queued completion impossible. The reducer must reject completions whose request id and buffer id do not match the active state. `web/packages/agenta-entities/src/session/api/client.ts:65-91`

#### 2.10 `saved -> read` is unspecified

The design requires an approximately two-second Saved chip and then a return to viewing. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:485-492`

The transition table has a success transition into `saved`, but no action that exits `saved`. `docs/design/file-drawer-edit-mode/plan.md:125-141`

The record contains `savedAt`, but no timer owner, timer cancellation rule, or transition atom. `docs/design/file-drawer-edit-mode/plan.md:42-45`

If the timer lives in `useDriveEdit`, it must be cancelled when the buffer closes, the drawer unmounts, the drive generation changes, or a new edit starts. None of those rules is planned. `web/oss/src/components/Drives/FilesDrawer.tsx:35-56` `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`

#### 2.11 Storing `AbortController` in the Jotai value is legal but structurally wrong here

Jotai does not require atom values to be serializable; non-serializability alone is not a blocker. The proposed atom is a normal in-memory atom, not storage-backed. `docs/design/file-drawer-edit-mode/plan.md:95-100`

The problem is lifecycle and mutation: an `AbortController` is a mutable imperative resource, while the module-level atom intentionally outlives the component that created it. `docs/design/file-drawer-edit-mode/plan.md:43-45` `docs/design/file-drawer-edit-mode/plan.md:105-111`

Existing upload code keeps abort controllers in hook refs and keeps serializable upload status in React state. `web/oss/src/components/Drives/useMountUpload.ts:68-83`

Follow that precedent: keep the controller in the owning hook, and put only request identity/status in the reducer state. `web/oss/src/components/Drives/useMountUpload.ts:73-79`

### State-by-state audit of the authoritative `NOTES`

| State | Verdict |
|---|---|
| `read` | Expressible through `affordance`, but “read-only mount” is approximated by `canUpload`, not verified permission or mount capability. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:438-446` `docs/design/file-drawer-edit-mode/plan.md:524-537` |
| `clean` | Partly expressible. The plan omits the `⌘E` trigger, does not guarantee cursor-at-start, and proposes `inert` on a component that has no such prop. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:448-456` `docs/design/file-drawer-edit-mode/plan.md:219-228` `web/oss/src/components/Drives/DriveTreePane.tsx:13-30` |
| `dirty` | Draft inequality can express dirty, and the header chip is straightforward; the tree dot cannot be implemented from `DriveTreeRow` without supplying a family key or context. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:458-465` `docs/design/file-drawer-edit-mode/plan.md:115-120` `web/oss/src/components/Drives/DriveTreeRow.tsx:15-50` |
| `preview` | The record can remain dirty while `view="preview"`, but the plan omits the spec’s visible-but-disabled formatting controls entirely. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:467-474` `docs/design/file-drawer-edit-mode/plan.md:238-240` |
| `saving` | Not sound: `state="readOnly"` is visual, and no abort transition exists. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:476-483` `web/packages/agenta-ui/src/SharedEditor/SharedEditor.tsx:132-150` `docs/design/file-drawer-edit-mode/plan.md:125-141` |
| `saved` | Not expressible correctly because there is no save snapshot, no timer transition, and the response has no mtime. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:485-492` `docs/design/file-drawer-edit-mode/plan.md:23-46` `api/oss/src/apis/fastapi/mounts/models.py:102-104` |
| `error` | Buffer preservation is expressible, but retry semantics are not defined against a specific failed save snapshot. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:494-501` `docs/design/file-drawer-edit-mode/plan.md:137` |
| `conflict` | The banner is expressible; reliable detection and the reload transition are not. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:503-510` `docs/design/file-drawer-edit-mode/plan.md:436-512` |
| `confirm` | `pendingExit` expresses the dialog, but the plan cannot execute most intent variants from a pure atom, and browser unload necessarily uses the browser dialog rather than the same modal. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:512-519` `docs/design/file-drawer-edit-mode/plan.md:52-58` `docs/design/file-drawer-edit-mode/plan.md:150-161` |
| `code` | The orthogonal mode is sound, and the mapper covers current languages. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:521-528` `docs/design/file-drawer-edit-mode/plan.md:349-364` |
| `locked` | Kind-based hiding is expressible; actual read-only mount status is not present in `mountSchema`. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:530-537` `web/packages/agenta-entities/src/session/core/schema.ts:171-177` |
| `capped` | `STATES` contains it, but `NOTES` has no `capped` entry at all. Selecting it makes `note` undefined and then dereferences `note.title`; the authoritative prototype itself is broken here. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:423-436` `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:438-539` `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:557-563` `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:629-631` |

### Should-fix

#### 2.12 Preview precedence is lossy, though dirty remains derivable

The first-match table returns `preview` before `dirty`. `docs/design/file-drawer-edit-mode/plan.md:69-84`

The plan then incorrectly says “phase beats view”; the table does the opposite for clean/dirty versus preview. `docs/design/file-drawer-edit-mode/plan.md:84-87`

The UI can still know it is dirty through the separate `driveEditDirtyAtomFamily`, so the dirty chip need not disappear in preview. `docs/design/file-drawer-edit-mode/plan.md:113-120`

The derived label itself cannot tell whether preview is clean or dirty. That makes it a poor state API and a poor test oracle. `docs/design/file-drawer-edit-mode/plan.md:79-82` `docs/design/file-drawer-edit-mode/plan.md:592-594`

Return orthogonal facets—`mode`, `view`, `saveStatus`, `dirty`, `blockingDialog`, `banner`—or remove the 12-name label entirely. The record already contains those dimensions. `docs/design/file-drawer-edit-mode/plan.md:23-46`

#### 2.13 The claimed 12-label test is impossible

The plan says `deriveEditStatus` will have one assertion per spec name, twelve total. `docs/design/file-drawer-edit-mode/plan.md:592-594`

It explicitly says `code` is never returned by that function. `docs/design/file-drawer-edit-mode/plan.md:89-91`

A function that cannot return `code` cannot have a producing test case for all twelve names. `docs/design/file-drawer-edit-mode/plan.md:69-91`

#### 2.14 The module-level family retains large buffers indefinitely

Mount file query bodies have an explicit one-minute garbage-collection time because they can be roughly 1.5 MB strings. `web/packages/agenta-entities/src/session/state/mounts.ts:193-209`

The proposed atom family stores both `original` and `draft`, intentionally survives unmount, and has no removal policy. `docs/design/file-drawer-edit-mode/plan.md:23-35` `docs/design/file-drawer-edit-mode/plan.md:95-111`

Every distinct mount key can therefore retain two large strings for the module lifetime after drawer churn. `docs/design/file-drawer-edit-mode/plan.md:95-111`

Use an explicit cleanup/removal policy or keep the draft in a provider scoped to the drawer shell that owns the guard. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`

#### 2.15 The session-teardown warning is missing

The design’s rules require a first-edit warning for session-scoped files because the session can be torn down. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:411-414`

No field, action, UI component, or implementation step handles that warning. `docs/design/file-drawer-edit-mode/plan.md:23-245`

## 3. Layer, seam, file organization, naming

### Blockers

#### 3.1 Guard ownership belongs above `DriveExplorer`

`FilesDrawer` owns the actual antd `EnhancedDrawer`, its controlled `open`, its real `onClose`, and `destroyOnClose`. `web/oss/src/components/Drives/FilesDrawer.tsx:76-125`

The plan wraps only the `onClose` passed down to `DriveHeader`. `docs/design/file-drawer-edit-mode/plan.md:154-160`

Antd receives the original host `onClose` directly from `FilesDrawer`, so mask-click and keyboard dismissal bypass the child wrapper. `web/oss/src/components/Drives/FilesDrawer.tsx:95-104` `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx:71-80`

The edit boundary must own or wrap `FilesDrawer.onClose`, not merely the header button callback. `web/oss/src/components/Drives/DriveHeader.tsx:122-130`

#### 3.2 `DriveTreeRow` cannot read the proposed keyed atom directly

`DriveTreeRow` receives a node and UI callbacks; it receives neither primary drive id nor target mount id. `web/oss/src/components/Drives/DriveTreeRow.tsx:15-50`

`DriveTreeList` also receives no drive key. `web/oss/src/components/Drives/DriveTreeList.tsx:22-69`

The plan’s claim that the row can call `driveEditPathAtomFamily` with “no prop drilling” omits the parameter required to select the atom-family member. `docs/design/file-drawer-edit-mode/plan.md:115-120` `docs/design/file-drawer-edit-mode/plan.md:215-217`

Do not subscribe every virtualized row to a large edit atom family. Pass one `dirtyPath` to `DriveTreeList`, use a small scoped context, or cut the dot from the first PR. `web/oss/src/components/Drives/DriveTreeList.tsx:115-158`

#### 3.3 The proposed `useDriveEdit` signature lacks the data it needs

The plan calls `useDriveEdit({drive, selectedPath, select, onClose, canUpload})`. `docs/design/file-drawer-edit-mode/plan.md:219-223`

Opening safely also needs:

- Resolved target mount and mount-relative path, because `agent-files/` maps to another mount. `web/oss/src/components/Drives/useSessionDrive.ts:188-194`
- Raw content query state, including pending and failure. `web/oss/src/components/Drives/driveFileSource.tsx:63-84`
- The selected listing record’s `mtime`, which `DriveTreeNode` discards. `web/oss/src/components/Drives/driveTree.ts:10-21` `web/oss/src/components/Drives/driveTree.ts:160-176`
- The active `includeGitignored` value, because it is part of every directory query key. `web/packages/agenta-entities/src/session/state/mounts.ts:42-47`
- A shell-level close continuation, because the child `onClose` is not authoritative. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`

The hook interface is under-specified before implementation begins. `docs/design/file-drawer-edit-mode/plan.md:219-237`

### Should-fix

#### 3.4 Four logic files are defensible; eleven flat files are not

Separating pure model logic, reducer state, transport, and a controller hook is a reasonable boundary. Their current names—`driveEdit.ts`, `driveEditState.ts`, `driveEditSave.ts`, and `useDriveEdit.ts`—are too similar in an import list and reveal no hierarchy. `docs/design/file-drawer-edit-mode/plan.md:230-245`

The frontend conventions call for module-local components, hooks, assets, and types to be organized within a feature module. `web/AGENTS.md:165-182`

Use an `editMode/` directory:

- `model.ts`
- `state.ts`
- `api.ts`
- `useDriveEditController.ts`
- `components/EditBar.tsx`
- `components/EditGuardModal.tsx`
- focused colocated tests. `web/AGENTS.md:170-180`

This is progressive organization inside the existing Drives module, not a package extraction or broad refactor. `web/AGENTS.md:178-182`

#### 3.5 The header prop group is acceptable; the inconsistency is the unscoped tree atom

A one-level prop group of config and callbacks is permitted when the parent owns the state. `web/AGENTS.md:207-209`

Therefore an `edit` object passed from the composition root to `DriveHeader` is not inherently wrong. `docs/design/file-drawer-edit-mode/plan.md:175-188`

The inconsistency is claiming atom-first sharing for a deeply nested tree row without providing atom scope, while using explicit props for the direct child. `docs/design/file-drawer-edit-mode/plan.md:115-120` `docs/design/file-drawer-edit-mode/plan.md:175-188`

Choose one coherent seam:

- A scoped `DriveEditProvider` around the drawer chrome for header, banner, body, and guard.
- Or explicit controller props to direct children plus a single `dirtyPath` passed through the tree list. `web/AGENTS.md:184-209`

#### 3.6 `DriveExplorer` is already the composition root; it should not own all modal and lifecycle behavior

`DriveExplorer` already coordinates filters, selection, uploads, tree data, header state, folder/file content, toolbar, and tree pane. `web/oss/src/components/Drives/DriveExplorer.tsx:90-210` `web/oss/src/components/Drives/DriveExplorer.tsx:235-328` `web/oss/src/components/Drives/DriveExplorer.tsx:332-415`

The plan adds a controller hook, toolbar swap, header prop group, four guarded selection consumers, a banner, two modals, keyboard listeners, `beforeunload`, and tree inertness. `docs/design/file-drawer-edit-mode/plan.md:219-228` `docs/design/file-drawer-edit-mode/plan.md:230-245`

Keep `DriveExplorer` as the declarative composition point, but put the behavior in one `DriveEditBoundary` or controller object. The real close guard must still be owned by `FilesDrawer`. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`

#### 3.7 `DriveTreePane` has no inert seam

`DriveTreePane` accepts geometry, key handling, drop props, rows, and children. It has no `inert`, editing, or class-name prop. `web/oss/src/components/Drives/DriveTreePane.tsx:13-30`

Its resize handle is a sibling of the tree motion element, so applying inertness only to the tree pane would not automatically disable resizing. `web/oss/src/components/Drives/DriveTreePane.tsx:45-92`

Drop handlers are spread onto the scroll container separately. `web/oss/src/components/Drives/DriveTreePane.tsx:61-70`

The plan must explicitly change `DriveTreePane` or place an edit boundary around all navigation and drag surfaces. `docs/design/file-drawer-edit-mode/plan.md:219-228`

#### 3.8 App-layer placement is correct; the proposed API/schema split is not

The edit UI and its drawer-specific controller belong under `web/oss/src/components/Drives/` because they are currently used by one feature. `web/AGENTS.md:431-442`

The transport wrapper and schema are split awkwardly: the plan adds the response schema to `@agenta/entities/session/core/schema.ts` but keeps the Fern call in an app file. `docs/design/file-drawer-edit-mode/plan.md:378-417`

The frontend API convention says Fern access, response validation, and schema boundary should live together, using `@agenta/sdk/resources` and `safeParseWithLogging`. `web/AGENTS.md:28-84`

The session package already centralizes mount reads and their validation. `web/packages/agenta-entities/src/session/api/api.ts:634-689`

Either:

- Add `writeMountFileContent` beside `readMountFile`, export its schema and function through `@agenta/entities/session`.
- Or keep the entire write boundary in the app and import the accessor from `@agenta/sdk/resources` plus the public shared parser. `web/AGENTS.md:74-84`

The current half-package, half-app split is the worst of both. `docs/design/file-drawer-edit-mode/plan.md:378-417`

#### 3.9 The plan uses a query-key helper that is not publicly exported

`mountDirQueryKey` exists in the internal state module. `web/packages/agenta-entities/src/session/state/mounts.ts:42-47`

The public `@agenta/entities/session` barrel exports the directory query family but not `mountDirQueryKey`. `web/packages/agenta-entities/src/session/index.ts:81-93`

The package exposes only the `./session` subpath, not arbitrary internal files. `web/packages/agenta-entities/package.json:31-49`

The proposed app-layer `driveEditSave.ts` therefore cannot import that helper through the sanctioned public export unless the barrel changes. `docs/design/file-drawer-edit-mode/plan.md:419-430`

#### 3.10 Naming changes

- `driveEditAffordance` should be `getDriveEditAvailability`; `"offer" | "capped" | "hidden"` should be `"enabled" | "too-large" | "unavailable"` because “offer” describes presentation, not capability. `docs/design/file-drawer-edit-mode/plan.md:60-65`
- `phase` should be `saveStatus` if its values remain `clean | dirty | saving | saved`, although dirty is better derived separately. `docs/design/file-drawer-edit-mode/plan.md:31-38`
- `view` is acceptable as `editorView`; bare `view` is too generic beside drawer and preview views. `docs/design/file-drawer-edit-mode/plan.md:36-38`
- `banner` should be `blockingIssue` or separate `saveError` and `conflict`; overwriting one error with another destroys information. `docs/design/file-drawer-edit-mode/plan.md:38-50` `docs/design/file-drawer-edit-mode/plan.md:143-144`
- `pendingExit` should be `pendingNavigation` or `exitRequest`; “exit” does not reveal that selection and reload are included. `docs/design/file-drawer-edit-mode/plan.md:39` `docs/design/file-drawer-edit-mode/plan.md:52-58`
- `forceNextSave` should be `skipConflictCheckOnce`; the current name does not say what is forced or what safety check is bypassed. `docs/design/file-drawer-edit-mode/plan.md:40-41`
- `adoptTheirsAtom` should be `replaceBufferFromRemoteAtom`; “theirs” becomes unclear outside conflict-dialog copy. `docs/design/file-drawer-edit-mode/plan.md:140`

### Nit

#### 3.11 `canUpload` is an expedient capability proxy, not proof of a writable mount

The current upload gate is feature flag plus non-local mode plus a present primary mount. `web/oss/src/components/Drives/useDriveUploads.ts:62-68`

`mountSchema` has no read-only flag, so the plan is right not to invent one. `web/packages/agenta-entities/src/session/core/schema.ts:171-177`

Call the local value `canEditMountFiles` only after deriving it deliberately from the upload capability; do not document it as actual backend writability. `docs/design/file-drawer-edit-mode/plan.md:532-537`

## 4. What will actually break

### Blockers

#### 4.1 The five-second conflict grace window creates a silent overwrite

The plan skips both activity detection and the pre-write mtime check for five seconds after a successful save. `docs/design/file-drawer-edit-mode/plan.md:489-503`

Failing sequence:

1. User saves version U1.
2. The agent writes version A1 to the same path one second later.
3. User edits to U2 and saves two seconds later.
4. Both conflict triggers are suppressed.
5. U2 silently overwrites A1. `docs/design/file-drawer-edit-mode/plan.md:489-503`

The status document acknowledges that an agent write in the window is missed but claims the next save catches it. The next save can itself occur inside the same window, so that claim is false. `docs/design/file-drawer-edit-mode/status.md:43-47`

#### 4.2 The same grace window can create a false conflict

The write response contains no mtime. `api/oss/src/apis/fastapi/mounts/models.py:102-104`

The plan depends on a later directory refetch to adopt the new mtime. `docs/design/file-drawer-edit-mode/plan.md:495-498`

Failing sequence:

1. User saves.
2. Directory refetch fails, is cancelled, or never produces the edited entry.
3. `baseMtime` remains the pre-save value.
4. Five seconds elapse.
5. User saves again.
6. The pre-write listing sees the user’s first write mtime and reports it as an external conflict. `docs/design/file-drawer-edit-mode/plan.md:467-498`

There is no “baseline refresh failed” state to prevent this. `docs/design/file-drawer-edit-mode/plan.md:23-46`

#### 4.3 Adopting the “real mtime” can adopt an agent write without adopting its content

Failing sequence:

1. User saves U1.
2. Agent writes A1 before the directory refetch resolves.
3. Refetch returns A1’s mtime.
4. The plan writes that mtime into `baseMtime` but leaves the buffer/cache content as U1.
5. User saves U2.
6. Pre-write mtime matches the adopted A1 mtime, so U2 overwrites A1 without conflict. `docs/design/file-drawer-edit-mode/plan.md:495-503`

An mtime fetched after a write is not proof that it belongs to that write. The design needs a server-supplied version/etag/mtime or it must exit edit mode after a successful save and reopen against a fresh read. `api/oss/src/apis/fastapi/mounts/models.py:102-104`

#### 4.4 The activity trigger usually cannot resolve a lazy-drawer path

File activity resolves tool paths only by scanning cached queries under the full-listing prefix `["mounts", "files", projectId]`. `web/packages/agenta-entities/src/session/state/fileActivity.ts:86-99`

The drawer normally loads per-directory `files-dir` queries and fetches the full `files` query only while search is active. `web/oss/src/components/Drives/useLazyDriveTree.tsx:1-11` `web/oss/src/components/Drives/useLazyDriveTree.tsx:117-138`

Therefore a normal open drawer can receive an activity entry with no `resolved` mount/path, causing `conflictFromActivity` to reject it. `web/packages/agenta-entities/src/session/state/fileActivity.ts:121-130` `docs/design/file-drawer-edit-mode/plan.md:447-457`

This trigger is not merely absent in the config host; it is unreliable in the chat host too. `docs/design/file-drawer-edit-mode/plan.md:461-465`

#### 4.5 Self-invalidation does not create file activity

File activity is recorded from detected agent tool calls and then triggers revalidation. `web/packages/agenta-entities/src/session/state/fileActivity.ts:1-15` `web/packages/agenta-entities/src/session/state/fileActivity.ts:75-139`

A frontend upload/save invalidation does not itself append an activity entry. `web/packages/agenta-entities/src/session/state/fileActivity.ts:121-138`

The grace window’s stated reason—preventing the feature’s own invalidation from creating an activity conflict—is based on a nonexistent feedback path. `docs/design/file-drawer-edit-mode/plan.md:489-493`

#### 4.6 Deletion is treated as permission to recreate the file

The pre-write check only conflicts when both mtimes are non-null and unequal. `docs/design/file-drawer-edit-mode/plan.md:472-478`

If the agent deletes the file, the directory entry is absent, so `theirMtime` is null/undefined and the plan proceeds. `docs/design/file-drawer-edit-mode/plan.md:472-478`

The multipart upload then writes a new object at the same path, recreating the deleted file. `api/oss/src/apis/fastapi/mounts/utils.py:79-91` `api/oss/src/core/mounts/service.py:1476-1493`

Missing entry must be a conflict, not “mtime unavailable.” `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:503-510`

#### 4.7 Drawer mask click and antd Escape bypass the guard

`FilesDrawer` gives the host `onClose` directly to `EnhancedDrawer`. `web/oss/src/components/Drives/FilesDrawer.tsx:95-104`

`EnhancedDrawer` spreads that callback into antd’s `Drawer`. `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx:71-80`

The plan only wraps the callback passed to `DriveHeader`. `docs/design/file-drawer-edit-mode/plan.md:154-160`

Failing sequence:

1. Edit and dirty a file.
2. Click the drawer mask or press Escape handled by antd.
3. Antd invokes the shell’s raw `onClose`.
4. The host sets `open=false`.
5. `destroyOnClose` unmounts the editor without the proposed guard. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`

A second window-level Escape listener inside `useDriveEdit` does not establish ordering or prevent antd from also closing. `docs/design/file-drawer-edit-mode/plan.md:154-161`

#### 4.8 Changed `initialPath` bypasses a wrapped selection callback

`useDriveSelection` handles changed `initialPath` internally by calling its own `select` inside an effect. `web/oss/src/components/Drives/useDriveSelection.ts:84-90`

Wrapping the returned `select` after the hook call does not intercept that internal effect. `web/oss/src/components/Drives/DriveExplorer.tsx:103-106`

Failing sequence:

1. Dirty a file opened from chat.
2. Another chat link updates quick-look `initialPath`.
3. `useDriveSelection` calls raw `select(initialPath)`.
4. Selection changes behind the edit buffer without a guard. `web/oss/src/components/Drives/SessionFilesDrawer.tsx:50-55` `web/oss/src/components/Drives/useDriveSelection.ts:84-90`

The guard must be integrated into selection ownership, not wrapped only at consumer props. `docs/design/file-drawer-edit-mode/plan.md:158-160`

#### 4.9 Drive/session replacement remounts the editor without a guard

`FilesDrawer` intentionally changes the `DriveExplorer` React key when one real mount is replaced by another. `web/oss/src/components/Drives/FilesDrawer.tsx:35-56`

The config host can change its resolved session when the active tab disappears and falls back to another session. `web/oss/src/components/Drives/configDrive.ts:35-59`

Failing sequence:

1. Dirty a file in the config drawer.
2. The active session changes underneath the panel.
3. `drive.mount.id` changes.
4. `useDriveGeneration` increments.
5. React unmounts the old `DriveExplorer` with no edit guard. `web/oss/src/components/Drives/FilesDrawer.tsx:93-114`

A child-level guard cannot prevent its parent from replacing its key. `web/oss/src/components/Drives/FilesDrawer.tsx:112-124`

#### 4.10 Drag spring-navigation bypasses the wrapped consumers

`useDriveUploads` is currently created before any proposed wrapper and receives the raw `select`. `web/oss/src/components/Drives/DriveExplorer.tsx:123-137`

It passes that selection callback to `useDriveDrop`. `web/oss/src/components/Drives/useDriveUploads.ts:87-93`

Hovering a dragged file over a folder invokes `onNavigate(path)` after a timer. `web/oss/src/components/Drives/useDriveDrop.ts:94-105`

Failing sequence:

1. Dirty a file.
2. Drag a file over a folder in any still-active drop target.
3. Wait 700 ms.
4. Spring navigation calls raw `select`.
5. Selection changes without the guard. `web/oss/src/components/Drives/useDriveDrop.ts:94-105`

The proposed visual `pointer-events-none` is not a substitute for disabling controller-level navigation and outstanding timers. `docs/design/file-drawer-edit-mode/plan.md:227-228`

#### 4.11 Unmount while saving leaves an identity and cleanup race

The drawer uses `destroyOnClose`. `web/oss/src/components/Drives/FilesDrawer.tsx:95-104`

The buffer and `AbortController` intentionally survive the unmount in a module-level atom family. `docs/design/file-drawer-edit-mode/plan.md:95-111`

No cleanup step aborts on shell unmount, clears the controller, or marks the request stale. `docs/design/file-drawer-edit-mode/plan.md:125-141`

Failing sequence:

1. Start saving.
2. Parent route navigation or host state unmounts the drawer.
3. The request continues.
4. The component that would own cache updates and timer effects is gone.
5. The completion can later mutate a retained or replacement atom-family buffer. `docs/design/file-drawer-edit-mode/plan.md:95-111` `docs/design/file-drawer-edit-mode/plan.md:135-141`

#### 4.12 The proposed directory query can check the wrong listing variant

`mountDirQueryKey` includes `includeGitignored`. `web/packages/agenta-entities/src/session/state/mounts.ts:42-47`

The plan’s fetch and invalidation examples omit that argument, which defaults to false. `docs/design/file-drawer-edit-mode/plan.md:426-430` `docs/design/file-drawer-edit-mode/plan.md:472-478`

If the user enabled “show git-ignored files” and edits one of those entries, the pre-write fetch can query the filtered listing where the file is absent. `web/oss/src/components/Drives/useDriveFilters.ts:14-17` `web/packages/agenta-entities/src/session/state/mounts.ts:157-190`

That absent entry then falls into the plan’s “no comparable mtime, proceed” path. `docs/design/file-drawer-edit-mode/plan.md:472-479`

### Should-fix

#### 4.13 The explicit tree, breadcrumb, folder, and preview consumers can be wrapped

`DriveExplorer` passes `select` to `FolderView`, `DriveFilePreview`, `DriveTreeList`, and `DriveHeader`. `web/oss/src/components/Drives/DriveExplorer.tsx:250-323` `web/oss/src/components/Drives/DriveExplorer.tsx:337-371`

Those explicit paths can use a guarded callback. The plan is right about those consumers. `docs/design/file-drawer-edit-mode/plan.md:158-160`

The missed routes are the shell, internal `initialPath` effect, drive remount, drag spring-navigation, and parent unmount. `web/oss/src/components/Drives/FilesDrawer.tsx:35-56` `web/oss/src/components/Drives/useDriveSelection.ts:84-90` `web/oss/src/components/Drives/useDriveDrop.ts:94-105`

#### 4.14 The filter route is currently unreachable, as the plan says

The toolbar owns search, origin, hidden-file, and gitignored controls. `web/oss/src/components/Drives/DriveExplorer.tsx:393-408`

Replacing the toolbar during editing removes those controls. `docs/design/file-drawer-edit-mode/plan.md:205-207`

That specific conclusion is correct. Keeping `{kind:"filter"; run}` in the union is still unnecessary first-PR machinery. `docs/design/file-drawer-edit-mode/plan.md:52-58`

#### 4.15 CSV inclusion is correct

`csv` is not in `TEXT_KINDS`, but the renderer explicitly applies the text cap to `csv` and dispatches it to `CsvBody`. `web/oss/src/components/Drives/renderers.tsx:585-638`

`CsvBody` reads the raw string and parses it for display. `web/oss/src/components/Drives/renderers.tsx:205-215`

Editing CSV as a raw source buffer and returning to a table after save is consistent with the existing read view and the design’s editable-kind list. `docs/design/file-drawer-edit-mode/plan.md:545-562` `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:411-414`

Research is right here. `docs/design/file-drawer-edit-mode/research.md:164-167`

#### 4.16 `.env` works end to end in the existing browser

The resolver regex includes `env`, and a leading dot satisfies the extension separator. `web/oss/src/components/Drives/driveKinds.ts:63-82`

Hidden paths are detected by dot-prefixed path segments but are not classified as internal. `web/oss/src/components/Drives/driveTree.ts:42-55`

Hidden files are shown by default. `web/oss/src/components/Drives/useDriveFilters.ts:10-17`

The tree dims hidden rows rather than removing them when the filter allows them. `web/oss/src/components/Drives/DriveTreeRow.tsx:52-80`

The breadcrumb displays the path segments verbatim and allows ancestor navigation. `web/oss/src/components/Drives/DriveBreadcrumb.tsx:21-64`

Research correction 7 is correct for resolver, visibility, tree, and breadcrumb. `.env.local` remains `other`. `web/oss/src/components/Drives/driveKinds.ts:63-82`

#### 4.17 The size cap compares backend bytes, but later fallbacks mix units

The existing cap is documented and applied as bytes from the listing. `web/oss/src/components/Drives/renderers.tsx:40-42` `web/oss/src/components/Drives/renderers.tsx:590-628`

That is the right unit for controlling object size. The editable buffer is a JavaScript string, so `content.length` is not a byte count. `docs/design/file-drawer-edit-mode/plan.md:382-395`

The plan falls back to `content.length` if response parsing fails or size is absent, then treats that as the written size. `docs/design/file-drawer-edit-mode/plan.md:392-395`

The backend response already defines `size` as an integer defaulting to zero, so the frontend schema should require a number and reject malformed responses instead of inventing a character-count byte size. `api/oss/src/apis/fastapi/mounts/models.py:102-104`

#### 4.18 Unknown or stale listing size can bypass the cap

The cap deliberately skips unknown size. `web/oss/src/components/Drives/renderers.tsx:590-612`

The tree builder converts `null` size to `0`, losing the distinction between empty and unknown. `web/oss/src/components/Drives/driveTree.ts:160-176`

The proposed affordance similarly offers Edit when `size == null`. `docs/design/file-drawer-edit-mode/plan.md:524-529`

A stale small listing can also offer Edit even if the file grew before the raw content read. The content query has no independent cap. `web/packages/agenta-entities/src/session/state/mounts.ts:193-209`

At minimum, enforce the cap again after the string loads and before save; do not rely solely on the listing snapshot. `docs/design/file-drawer-edit-mode/plan.md:518-529`

#### 4.19 Header size can remain stale after the proposed invalidation

The header prefers `drive.recents` size over the current tree node size. `web/oss/src/components/Drives/DriveExplorer.tsx:180-193`

The plan invalidates the directory and the whole `files` listing, but the lightweight summary’s recents may come from record data or root/latest queries rather than that full listing. `docs/design/file-drawer-edit-mode/plan.md:419-430` `web/oss/src/components/Drives/useSessionDrive.ts:321-369`

Existing upload refresh invalidates `files`, `files-latest`, `files-root`, and `files-dir`. `web/oss/src/components/Drives/useMountUpload.ts:85-90`

The save invalidation should use the same relevant roots or update the exact visible data source deliberately. `docs/design/file-drawer-edit-mode/plan.md:421-434`

#### 4.20 Correction 1 is correct: multipart reaches the same write service

Generated `writeMountFile` sends query parameters and no body. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:1072-1102`

Its request type contains only `mount_id` and `path`. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/requests/WriteMountFileRequest.ts:10-13`

The backend raw-write handler reads the request body, so that generated call would write empty bytes. `api/oss/src/apis/fastapi/mounts/router.py:570-587`

Generated `uploadMountFile` constructs multipart form data and appends the file. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:822-865`

Its request type contains `mount_id`, optional `path`, and `file`. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/requests/BodyUploadMountFile.ts:12-15`

The Python upload helper uses a full non-trailing `path` verbatim, reads all uploaded bytes, and calls the same `write_file` service. `api/oss/src/apis/fastapi/mounts/utils.py:66-91`

The service validates the path and performs a full `put_object` overwrite with no rename or collision suffixing. `api/oss/src/core/mounts/service.py:1476-1493`

Filename is relevant only when `path` is absent or ends in `/`; the plan supplies a full path. `api/oss/src/apis/fastapi/mounts/utils.py:76-85`

Content type is ignored by the Python helper, and empty files or trailing newlines are delivered as uploaded bytes. `api/oss/src/apis/fastapi/mounts/utils.py:85-90`

The multipart route is not the problem. The lossy UTF-8 read and editor transformations are the problems. `api/oss/src/core/mounts/service.py:1461-1474` `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299`

#### 4.21 Correction 6 is correct: listings carry mtime

The frontend schema parses nullable `mtime`. `web/packages/agenta-entities/src/session/core/schema.ts:142-154`

The backend DTO defines epoch-millisecond mtime. `api/oss/src/core/mounts/dtos.py:63-74`

All three listing construction paths populate it from object metadata. `api/oss/src/core/mounts/service.py:1135-1145` `api/oss/src/core/mounts/service.py:1254-1263` `api/oss/src/core/mounts/service.py:1305-1315`

The stale comment in `useSessionDrive` is wrong. `web/oss/src/components/Drives/useSessionDrive.ts:68-72`

The plan’s actual problem is obtaining and retaining the correct raw listing entry; `DriveTreeNode` discards mtime. `web/oss/src/components/Drives/driveTree.ts:10-21` `web/oss/src/components/Drives/driveTree.ts:160-176`

## 5. What is over-built and should be cut from the first PR?

### Blockers to cut

1. **Cut the two-trigger conflict system.** Keep one pre-write listing check; activity resolution depends on a full-listing cache the lazy drawer usually does not have. Lost: an early warning before Save. `web/packages/agenta-entities/src/session/state/fileActivity.ts:86-99` `web/oss/src/components/Drives/useLazyDriveTree.tsx:117-138`

2. **Cut the self-write grace window.** It creates a documented silent-overwrite interval and a false-conflict path when baseline refresh fails. Lost: nothing worth preserving. `docs/design/file-drawer-edit-mode/plan.md:489-503`

3. **Cut the `DiffView` modal.** A first conflict dialog can offer Reload and explicit Overwrite; the modal adds a fresh read, parsed-diff failure modes, and another async lifecycle. Lost: side-by-side conflict inspection. `docs/design/file-drawer-edit-mode/plan.md:366-374` `web/packages/agenta-ui/src/Editor/plugins/code/extensions/diffHighlight.tsx:409-429`

4. **Cut rich-mode markdown editing.** Use `codeOnly` for raw markdown source or do not ship markdown edit in the first PR. Lost: rich source editing, which the design does not require. `web/packages/agenta-ui/src/Editor/Editor.tsx:249-266` `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299`

5. **Cut Save-and-continue from the first guard.** Keep Keep Editing and Discard; save continuation requires request identity and delayed navigation that the proposed reducer cannot represent. Lost: one-click save-and-navigate convenience. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:512-519` `docs/design/file-drawer-edit-mode/plan.md:132-137`

### Candidate-by-candidate judgment

- **Diff modal — cut.** It is a second async feature layered on an already incorrect conflict controller. `docs/design/file-drawer-edit-mode/plan.md:240-242` `docs/design/file-drawer-edit-mode/plan.md:505-512`
- **Two-trigger conflict detection — simplify.** Use only a pre-write check in the first PR; add activity-based early warning only after it can resolve `files-dir` cache entries. `web/packages/agenta-entities/src/session/state/fileActivity.ts:86-99`
- **Self-write grace window — cut.** A timer that disables the last-write-wins check is a correctness bug. `docs/design/file-drawer-edit-mode/plan.md:489-503`
- **Preview pane — cut from the first PR.** It is separable from edit-and-save and carries hidden-editor selection claims that are untested. Lost: rendered markdown while editing. `docs/design/file-drawer-edit-mode/plan.md:338-347`
- **Derived 12-name label table — cut.** It is lossy, contradicts its own precedence explanation, and cannot return all twelve names. `docs/design/file-drawer-edit-mode/plan.md:69-91`
- **Tree-row dirty dot — cut.** The header chip is enough for the first PR, and the row lacks the family key needed by the proposed atom read. Lost: the second dirty indicator. `docs/design/file-drawer-edit-mode/plan.md:215-217` `web/oss/src/components/Drives/DriveTreeRow.tsx:15-50`
- **`beforeunload` — keep, simplified.** Register only while dirty and rely on the browser-native prompt; do not route it through `ExitIntent`. `docs/design/file-drawer-edit-mode/plan.md:150-161`
- **Abort-during-save — simplify.** For the first PR disable Cancel while a write is in flight, or keep the controller in a hook ref with request identity; do not store it in the buffer. Lost: escape from a slow save. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:476-483` `web/oss/src/components/Drives/useMountUpload.ts:73-79`
- **Saved-chip timer — cut.** On success update the exact content cache, invalidate listings, and return directly to read mode. Lost: two seconds of confirmation chrome. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:485-492`
- **Status footer — cut.** Language is already present in the edit bar, `UTF-8` is misleading after replacement decoding, and cursor position needs selection plumbing absent from the plan. `docs/design/file-drawer-edit-mode/plan.md:296-321` `api/oss/src/core/mounts/service.py:1461-1474`
- **Formatting controls in preview — cut with preview.** The plan currently omits them despite the spec requiring them to remain visible. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:467-474`
- **Tree inertness — keep, but implement as capability disabling.** Disable selection, breadcrumb navigation, drop spring timers, folder drop, and resize explicitly; CSS opacity alone is not an interaction boundary. `web/oss/src/components/Drives/DriveTreePane.tsx:45-92` `web/oss/src/components/Drives/useDriveDrop.ts:94-105`
- **Error banner with Retry — keep.** Preserving the exact draft after write failure is core data safety. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:494-501`
- **Conflict overwrite confirmation — keep, simplified.** The first PR still needs a pre-write mismatch/missing-file barrier before overwriting. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:503-510`
- **Session-scoped first-edit warning — keep or explicitly defer in status.** It is an authoritative design rule currently missing from the plan. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:411-414`

### Smallest version I would merge

- Edit only after raw content has loaded successfully and the resolved target mount/path is known. `web/oss/src/components/Drives/driveFileSource.tsx:63-84` `web/oss/src/components/Drives/useSessionDrive.ts:188-194`
- Use one shell-level edit controller owned above `DriveExplorer`, with a stable buffer id and request id. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`
- Store `{driveKey, targetMountId, targetPath, displayPath, original, draft, baseMtime, bufferId}` and derive dirty from `draft !== original`. `docs/design/file-drawer-edit-mode/plan.md:23-46`
- Use `SharedEditor` in `codeOnly` mode for every editable kind, including markdown. `web/packages/agenta-ui/src/Editor/Editor.tsx:249-266`
- Pass `disabled` to both `EditorProvider` and `SharedEditor` while saving. `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx:262-279` `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx:183-216`
- Save through one validated session API wrapper around `uploadMountFile`, with an explicit full path and no transparent retries. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:822-865` `api/oss/src/apis/fastapi/mounts/utils.py:76-91`
- Immediately before save, fetch the exact directory variant and treat changed mtime or missing entry as conflict. `web/packages/agenta-entities/src/session/state/mounts.ts:42-47`
- Offer Reload and explicit Overwrite on conflict; no activity trigger, diff modal, or grace timer. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:503-510`
- On success, seed the exact saved draft into the content cache, invalidate the relevant listing roots, and close edit mode immediately. `web/packages/agenta-entities/src/session/state/mounts.ts:38-47` `web/oss/src/components/Drives/useMountUpload.ts:85-90`
- Guard the real drawer close, explicit selection, changed `initialPath`, and dirty browser unload. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125` `web/oss/src/components/Drives/useDriveSelection.ts:84-90`
- Disable all tree/drop navigation during edit instead of relying on a wrapped subset of callbacks. `web/oss/src/components/Drives/useDriveUploads.ts:87-93` `web/oss/src/components/Drives/useDriveDrop.ts:94-105`
- Defer preview, diff, tree dot, saved timer, cursor footer, activity-based early conflict, and Save-and-continue. `docs/design/file-drawer-edit-mode/plan.md:230-245`
- Add controller/integration tests for shell close, changed `initialPath`, missing-file conflict, ignored-file query keys, late save completion, and exact markdown backslash preservation. `docs/design/file-drawer-edit-mode/plan.md:575-626`

## Other findings

### Blockers

#### O.1 The plan’s public import surface does not compile as described

The new schema would need to be exported from `@agenta/entities/session`; the current barrel exports only existing mount schemas and types. `web/packages/agenta-entities/src/session/index.ts:43-61`

`mountDirQueryKey` is also missing from that public barrel. `web/packages/agenta-entities/src/session/index.ts:81-93`

The code snippet uses `safeParseWithLogging`, `mountFileWrittenResponseSchema`, `isAbortError`, and `toWriteErrorMessage` without showing sanctioned imports or defining the last helper. `docs/design/file-drawer-edit-mode/plan.md:378-400`

The plan must specify the package export changes or relocate the write boundary beside the existing session API. `web/packages/agenta-entities/src/session/api/api.ts:634-689`

#### O.2 Exact-byte round-trip QA cannot rescue a structurally lossy editor

The QA matrix requires markdown bytes to round-trip without reformatting. `docs/design/file-drawer-edit-mode/status.md:79-84`

The plan explicitly excludes Lexical markdown timing and behavior from automated testing. `docs/design/file-drawer-edit-mode/plan.md:622-626`

The rich editor serializes markdown and strips backslash escapes. `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299` `web/packages/agenta-ui/src/Editor/plugins/markdown/utils/textCleanup.ts:146-177`

This needs an automated regression test or a raw code editor, not faith in live QA. `docs/design/file-drawer-edit-mode/status.md:79-84`

### Should-fix

#### O.3 Test coverage targets pure helpers and misses the failure-prone seams

The test plan covers helpers and action atoms but deliberately excludes component/editor behavior. `docs/design/file-drawer-edit-mode/plan.md:575-626`

Missing high-value tests include:

- Raw markdown input preserving backslashes, blank final lines, and trailing newline. `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299`
- `SharedEditor` becoming genuinely non-editable during save. `web/packages/agenta-ui/src/Editor/Editor.tsx:455-457`
- Mask/Escape drawer close routing through the guard. `web/oss/src/components/Drives/FilesDrawer.tsx:95-125`
- Changed `initialPath` routing through the guard. `web/oss/src/components/Drives/useDriveSelection.ts:84-90`
- Late success from file A not mutating file B. `docs/design/file-drawer-edit-mode/plan.md:125-141`
- Deleted file producing conflict rather than recreation. `docs/design/file-drawer-edit-mode/plan.md:472-478`
- `includeGitignored=true` being present in the pre-write query key. `web/packages/agenta-entities/src/session/state/mounts.ts:42-47`
- Multipart request shape and exact target path. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:829-865`
- Content-cache and all visible listing invalidations after save. `web/oss/src/components/Drives/useMountUpload.ts:85-90`

#### O.4 The API-call placement only partially follows `web/AGENTS.md`

The plan correctly uses Fern rather than adding new axios code. `docs/design/file-drawer-edit-mode/plan.md:378-417` `web/AGENTS.md:28-32`

The convention says to use a per-resource accessor from `@agenta/sdk/resources` and perform Zod validation at the boundary. `web/AGENTS.md:74-84`

Importing the accessor and request helper from `@agenta/entities/session` is defensible only if the write itself becomes a session API function; exposing low-level client helpers to an app-local API module weakens that boundary. `web/packages/agenta-entities/src/session/index.ts:36-42`

#### O.5 Cache invalidation is too narrow for the actual drawer data model

The plan invalidates one directory and the full `files` listing. `docs/design/file-drawer-edit-mode/plan.md:419-434`

The drawer summary and header also use `files-latest` and `files-root` queries. `web/oss/src/components/Drives/useSessionDrive.ts:355-369`

The existing upload mutation invalidates all four listing roots. `web/oss/src/components/Drives/useMountUpload.ts:85-90`

Reuse that mutation invalidation policy unless there is a tested reason to narrow it. `web/oss/src/components/Drives/useMountUpload.ts:85-90`

#### O.6 Accessibility requirements are absent from the plan

Saving, Saved, errors, and conflicts are asynchronous status changes, but the plan does not specify an `aria-live` status region. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:476-510` `docs/design/file-drawer-edit-mode/plan.md:190-201`

Tree inertness must remove descendants from keyboard interaction as well as pointer interaction; the current tree contains focusable row buttons and a focusable resize separator. `web/oss/src/components/Drives/DriveTreeRow.tsx:61-72` `web/oss/src/components/Drives/DriveTreePane.tsx:77-90`

The guard should restore focus to the triggering control after Keep Editing; no focus-return behavior is planned. `docs/design/file-drawer-edit-mode/plan.md:150-161` `docs/design/file-drawer-edit-mode/plan.md:241-242`

`EnhancedModal` is the correct shared modal choice, but using it does not replace testing the edit-specific focus flow. `web/AGENTS.md:419-429`

#### O.7 `⌘E` is omitted

The authoritative clean-state trigger is “Edit clicked, or ⌘E.” `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:448-456`

The plan discusses Escape, Cmd/Ctrl-S, and browser unload but never adds an edit shortcut. `docs/design/file-drawer-edit-mode/plan.md:150-161` `docs/design/file-drawer-edit-mode/plan.md:575-626`

Either implement and test Cmd/Ctrl-E or record a deliberate design deviation. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:448-456`

#### O.8 Theme validation exists only as live QA

The repo requires light and dark interaction states for changed UI. `web/AGENTS.md:321-333`

The status file asks for both themes in live QA. `docs/design/file-drawer-edit-mode/status.md:79-84`

There is no component-level or visual test for error, conflict, disabled, saving, or saved colors. `docs/design/file-drawer-edit-mode/plan.md:575-626`

At minimum, all implementation classes must use semantic tokens, and QA must cover every new banner/modal state rather than only the happy-path editor. `web/AGENTS.md:321-348`

#### O.9 Copy and i18n surface are larger than acknowledged

The plan introduces Edit, Saving, Unsaved, Saved, editing hints, cap tooltip, retry, conflict actions, overwrite copy, guard actions, footer labels, and modal content. `docs/design/file-drawer-edit-mode/plan.md:190-201` `docs/design/file-drawer-edit-mode/plan.md:238-242`

No copy ownership or localization approach is specified. Existing Drives code contains English UI, so this is not a unique violation, but the first PR should avoid multiplying copy through optional diff/footer/preview states. `web/oss/src/components/Drives/DriveHeader.tsx:114-160`

#### O.10 The plan is likely to violate the comment-density rule if implemented literally

The frontend rule allows at most one short line per comment, with longer prose reserved for genuinely surprising constraints. `web/AGENTS.md:412-417`

The proposed plan contains extensive prop-by-prop and race explanations that should stay in design docs, not be copied into implementation comments. `docs/design/file-drawer-edit-mode/plan.md:303-336` `docs/design/file-drawer-edit-mode/plan.md:403-417`

Use names and tests to express the state transitions; reserve one-line comments for the multipart-body and stale-request constraints. `web/AGENTS.md:412-417`

#### O.11 The design’s `capped` prototype state is broken

`capped` exists in `STATES`. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:423-436`

There is no `NOTES.capped`. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:438-539`

The renderer treats every state except `read` and `locked` as editing, so `capped` also incorrectly enters editing layout. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:557-563`

It then dereferences the missing note. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:629-631`

The plan’s interpretation—disabled Edit with a cap tooltip—is supported by the `locked` notes, but the prototype should be corrected before anyone treats all 12 rendered states as authoritative. `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html:530-537`

### Research correction audit

1. **Correction 1 — correct.** Generated `writeMountFile` has no body; generated multipart upload carries the file and reaches the same `write_file` service. `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:1072-1102` `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:829-865` `api/oss/src/apis/fastapi/mounts/utils.py:66-91`

2. **Correction 2 — correct, but the plan still overstates JSON safety.** `DiffView` is JSON/YAML-only and its extension parses the strings; malformed JSON can still render no diff. `web/packages/agenta-ui/src/Editor/DiffView.tsx:178-199` `web/packages/agenta-ui/src/Editor/plugins/code/extensions/diffHighlight.tsx:409-429`

3. **Correction 3 — correct.** The README documents `containerVariant` and `debounceDelay`, while the real component does not accept them. `web/packages/agenta-ui/src/SharedEditor/README.md:36-47` `web/packages/agenta-ui/src/SharedEditor/types.ts:27-70`

4. **Correction 4 — correct.** The editor has a six-value language union and the drive resolver returns broader Shiki ids. `web/packages/agenta-ui/src/Editor/plugins/code/types.ts:1-3` `web/oss/src/components/Drives/driveKinds.ts:24-61`

5. **Correction 5 — correct only about command polarity.** `true` means source, but pinning that command does not make first hydration or later change emission byte-preserving. `web/packages/agenta-ui/src/Editor/plugins/markdown/markdownPlugin.tsx:151-168` `web/packages/agenta-ui/src/Editor/Editor.tsx:282-299`

6. **Correction 6 — correct.** Listing schemas and backend construction paths carry mtime. `web/packages/agenta-entities/src/session/core/schema.ts:145-153` `api/oss/src/core/mounts/service.py:1135-1145`

7. **Correction 7 — correct.** `.env` resolves as text, hidden files default visible, the tree dims rather than removes it, and the breadcrumb preserves it. `web/oss/src/components/Drives/driveKinds.ts:63-82` `web/oss/src/components/Drives/useDriveFilters.ts:10-17` `web/oss/src/components/Drives/DriveTreeRow.tsx:52-80` `web/oss/src/components/Drives/DriveBreadcrumb.tsx:21-64`
