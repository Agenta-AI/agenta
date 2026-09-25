/**
 * Pi's extension UI, carried as `extension_ui_request` events and `extension_ui_response` replies:
 * the protocol Pi's RPC mode speaks over stdio, here over an in-memory channel. pi-acp's session
 * consumes exactly this protocol, so dialogs raised by an in-process session reach the runner's
 * permission flow the same way they do from a Pi subprocess. The behavior of each method follows
 * Pi 0.85.1 `modes/rpc/rpc-mode.js` (`createExtensionUIContext`).
 */
import { randomUUID } from "node:crypto";
import type { ExtensionUIContext, ExtensionUIDialogOptions, Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionUiResponse } from "pi-acp/session";

export type ExtensionUiRequest = { type: "extension_ui_request"; id: string; method: string } & Record<string, unknown>;

type Pending = (response: ExtensionUiResponse) => void;

export class ExtensionUiChannel implements ExtensionUIContext {
  private readonly listeners = new Set<(request: ExtensionUiRequest) => void>();
  private readonly pending = new Map<string, Pending>();

  /** Subscribe to the requests the UI context raises. */
  onRequest(listener: (request: ExtensionUiRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The answer to a request, as pi-acp sends it back. Unknown ids are ignored, like Pi does. */
  respond(response: ExtensionUiResponse): void {
    const settle = this.pending.get(response.id);
    if (!settle) return;
    this.pending.delete(response.id);
    settle(response);
  }

  /** Cancel every open dialog (the session is going away). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.respond({ id, cancelled: true });
  }

  private send(request: Record<string, unknown> & { method: string }, id: string = randomUUID()): void {
    const event: ExtensionUiRequest = { type: "extension_ui_request", id, ...request };
    for (const listener of this.listeners) listener(event);
  }

  private dialog<T>(
    opts: ExtensionUIDialogOptions | undefined,
    fallback: T,
    request: Record<string, unknown> & { method: string },
    parse: (response: ExtensionUiResponse) => T,
  ): Promise<T> {
    if (opts?.signal?.aborted) return Promise.resolve(fallback);
    const id = randomUUID();
    return new Promise<T>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = (value: T) => {
        if (timer) clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        resolve(value);
      };
      const onAbort = () => finish(fallback);
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) timer = setTimeout(() => finish(fallback), opts.timeout);
      this.pending.set(id, (response) => finish(parse(response)));
      this.send({ ...request, ...(opts?.timeout ? { timeout: opts.timeout } : {}) }, id);
    });
  }

  select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    return this.dialog(opts, undefined, { method: "select", title, options }, (r) =>
      "cancelled" in r ? undefined : "value" in r ? r.value : undefined,
    );
  }

  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
    return this.dialog(opts, false, { method: "confirm", title, message }, (r) =>
      "cancelled" in r ? false : "confirmed" in r ? r.confirmed : false,
    );
  }

  input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    return this.dialog(opts, undefined, { method: "input", title, placeholder }, (r) =>
      "cancelled" in r ? undefined : "value" in r ? r.value : undefined,
    );
  }

  editor(title: string, prefill?: string): Promise<string | undefined> {
    return this.dialog(undefined, undefined, { method: "editor", title, prefill }, (r) =>
      "cancelled" in r ? undefined : "value" in r ? r.value : undefined,
    );
  }

  notify(message: string, type?: "info" | "warning" | "error"): void {
    this.send({ method: "notify", message, notifyType: type });
  }

  setStatus(key: string, text: string | undefined): void {
    this.send({ method: "setStatus", statusKey: key, statusText: text });
  }

  setWidget(key: string, content: unknown, options?: { placement?: string }): void {
    // Only string lines travel; component factories need a terminal.
    if (content === undefined || Array.isArray(content)) {
      this.send({ method: "setWidget", widgetKey: key, widgetLines: content, widgetPlacement: options?.placement });
    }
  }

  setTitle(title: string): void {
    this.send({ method: "setTitle", title });
  }

  setEditorText(text: string): void {
    this.send({ method: "set_editor_text", text });
  }

  pasteToEditor(text: string): void {
    this.setEditorText(text);
  }

  getEditorText(): string {
    return "";
  }

  onTerminalInput(): () => void {
    return () => {};
  }

  setWorkingMessage(): void {}
  setWorkingVisible(): void {}
  setWorkingIndicator(): void {}
  setHiddenThinkingLabel(): void {}
  setFooter(): void {}
  setHeader(): void {}
  addAutocompleteProvider(): void {}
  setEditorComponent(): void {}
  getEditorComponent(): undefined {
    return undefined;
  }

  custom<T>(): Promise<T> {
    return Promise.reject(new Error("Custom terminal UI is not available to an agent running in the runner."));
  }

  get theme(): Theme {
    throw new Error("Terminal themes are not available to an agent running in the runner.");
  }

  getAllThemes(): { name: string; path: string | undefined }[] {
    return [];
  }

  getTheme(): Theme | undefined {
    return undefined;
  }

  setTheme(): { success: boolean; error?: string } {
    return { success: false, error: "Theme switching not supported in RPC mode" };
  }

  getToolsExpanded(): boolean {
    return false;
  }

  setToolsExpanded(): void {}
}
