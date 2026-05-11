<!--
  Minimal chat UI — manual smoke surface. Assertions run via HTTP against
  /api/chat directly, so this page is optional for testing but useful for
  one-off browser verification.

  Uses the `Chat` class composable from @ai-sdk/vue (the Vue equivalent of
  @ai-sdk/react's useChat). Sends UIMessage payloads to /api/chat and renders
  the streamed response.
-->
<script setup lang="ts">
import {Chat} from "@ai-sdk/vue"
import {ref} from "vue"

const chat = new Chat({})
const input = ref("")

function onSubmit(): void {
    const text = input.value.trim()
    if (!text) return
    chat.sendMessage({text})
    input.value = ""
}
</script>

<template>
    <main style="max-width: 720px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui">
        <h1>Nuxt + AI SDK v6 spike (raw OTel)</h1>
        <p style="color: #666">
            Manual smoke surface. Assertions run via HTTP against /api/chat.
        </p>
        <ul style="padding: 0; list-style: none">
            <li
                v-for="m in chat.messages"
                :key="m.id"
                style="
                    margin: 0.5rem 0;
                    padding: 0.5rem;
                    border: 1px solid #eee;
                    border-radius: 6px;
                "
            >
                <strong>{{ m.role }}:</strong>
                <template v-for="(p, i) in m.parts" :key="i">
                    <span v-if="p.type === 'text'">{{ p.text }}</span>
                </template>
            </li>
        </ul>
        <form @submit.prevent="onSubmit" style="display: flex; gap: 8px">
            <input
                v-model="input"
                placeholder="say something..."
                style="flex: 1; padding: 0.5rem"
            />
            <button type="submit" :disabled="chat.status === 'streaming'">
                Send
            </button>
        </form>
    </main>
</template>
