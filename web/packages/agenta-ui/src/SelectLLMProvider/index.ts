/**
 * @module SelectLLMProvider
 *
 * LLM provider selection component with icon support.
 *
 * This module provides a base component that can be extended with
 * vault integration and other features in the main application.
 *
 * @example Basic Usage
 * ```tsx
 * import {SelectLLMProviderBase} from '@agenta/entities/ui'
 *
 * <SelectLLMProviderBase
 *   value={provider}
 *   onChange={(value) => setProvider(value)}
 *   options={[
 *     {label: 'OpenAI', options: [{label: 'gpt-4', value: 'gpt-4'}]},
 *     {label: 'Anthropic', options: [{label: 'claude-3', value: 'claude-3'}]},
 *   ]}
 *   showSearch
 *   showGroup
 * />
 * ```
 */

export {default as SelectLLMProviderBase} from "./SelectLLMProviderBase"
export type {SelectLLMProviderBaseProps, ProviderOption, ProviderGroup} from "./types"
export {capitalize, PROVIDER_ICON_MAP, getProviderIcon, getProviderDisplayName} from "./utils"
