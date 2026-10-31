/** Installed before plugin HTML so inline scripts can call the bridge immediately. */
export const pluginStub = `<script>
(() => {
  let port; let nextId = 0; let ready;
  const connected = new Promise(resolve => { ready = resolve; });
  const pending = new Map();
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.v !== 1 || event.data.type !== "hello" || !event.ports[0] || port) return;
    port = event.ports[0];
    port.onmessage = ({data}) => {
      const call = pending.get(data?.id); if (!call) return;
      pending.delete(data.id); clearTimeout(call.timer);
      data.ok ? call.resolve(data.result) : call.reject(new Error(data.error || "Plugin action failed"));
    };
    port.start(); ready();
  });
  window.agenta = {plugin: {call: async (operation, args = {}) => {
    await connected;
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("The action timed out and may still complete. Check its result before trying again.")); }, 90000);
      pending.set(id, {resolve, reject, timer});
      port.postMessage({v: 1, id, method: "plugin.call", operation, args});
    });
  }}};
})();
</script>`
