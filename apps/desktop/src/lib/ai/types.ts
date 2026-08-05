export interface AiProviderInfo {
  id: string;
  name: string;
  ready: boolean;
  message?: string;
}

export interface AiContext {
  scope:
    | "selection"
    | "file"
    | "chapter"
    | "preamble"
    | "bibliography"
    | "project";
  files: string[];
  action: "chat" | "proofread" | "fix" | "complete" | "explain";
  selection?: string;
  diagnostics?: AiDiagnostic[];
}

export interface AiDiagnostic {
  file: string;
  line: number;
  col: number;
  message: string;
  severity: string;
}

/**
 * Provider-neutral tool definition. Anthropic uses it as-is;
 * the OpenAI provider wraps it into function-calling format.
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiRequest {
  tabId: string;
  projectPath: string;
  prompt: string;
  model?: string;
  systemPrompt?: string;
  /**
   * Body of the active skill. Appended to the system prompt by the Rust side
   * (`providers::resolve_system_prompt`) rather than replacing it — routing a
   * skill through `systemPrompt` would drop the base LaTeX/propose_edit rules.
   */
  skillPrompt?: string;
  messages: AiMessage[];
  context?: AiContext;
  tools?: AiToolDefinition[];
}

export interface AiMessage {
  role: string;
  content?: AiContentBlock[];
  name?: string;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
}

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }
  | { type: "thinking"; thinking: string; signature?: string };

export interface AiToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface AiOutputEvent {
  tab_id: string;
  data: string;
  provider: string;
}

export interface AiCompleteEvent {
  tab_id: string;
  success: boolean;
  provider: string;
}

export interface AiErrorEvent {
  tab_id: string;
  data: string;
  provider: string;
}

export const AI_PROVIDERS = {
  NONE: "none",
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
} as const;

export type AiProviderId = (typeof AI_PROVIDERS)[keyof typeof AI_PROVIDERS];
