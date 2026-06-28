import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useClaudeChatStore,
  type ClaudeStreamMessage,
} from "@/stores/claude-chat-store";
import { useDocumentStore } from "@/stores/document-store";
import { useHistoryStore } from "@/stores/history-store";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import {
  compileLatex,
  resolveCompileTarget,
  formatCompileError,
} from "@/lib/latex-compiler";
import { readTexFileContent } from "@/lib/tauri/fs";
import { createLogger } from "@/lib/debug/logger";
import {
  parseAnthropicSSE,
  parseOpenAISSE,
  createAnthropicStreamState,
  createOpenAIStreamState,
  type AnthropicStreamState,
  type OpenAIStreamState,
} from "@/lib/ai/sse-parser";

const log = createLogger("ai-event");

interface AiOutputPayload {
  tab_id: string;
  data: string;
  provider: string;
}

interface AiCompletePayload {
  tab_id: string;
  success: boolean;
  provider: string;
}

interface AiErrorPayload {
  tab_id: string;
  data: string;
  provider: string;
}

/**
 * Hook that listens to provider-agnostic `ai-output`, `ai-complete`,
 * and `ai-error` Tauri events.
 *
 * For Claude CLI provider, the data lines are stream-json (same format
 * as before). For API providers (Anthropic/OpenAI), the data lines are
 * raw SSE chunks that need provider-specific parsing in the chat renderer.
 */
export function useAiEvents() {
  const pendingToolUsesRef = useRef(
    new Map<string, Map<string, { name: string; input: unknown }>>(),
  );
  const hasTexChangesRef = useRef(new Map<string, boolean>());
  const cancelledForAskRef = useRef(new Map<string, boolean>());
  const msgCountRef = useRef(new Map<string, number>());
  const streamStartTimeRef = useRef(new Map<string, number>());
  const lastMsgTimeRef = useRef(new Map<string, number>());
  const anthropicStateRef = useRef(new Map<string, AnthropicStreamState>());
  const openaiStateRef = useRef(new Map<string, OpenAIStreamState>());

  const tabs = useClaudeChatStore((s) => s.tabs);
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.isStreaming && !msgCountRef.current.has(tab.id)) {
        pendingToolUsesRef.current.set(tab.id, new Map());
        hasTexChangesRef.current.set(tab.id, false);
        cancelledForAskRef.current.set(tab.id, false);
        msgCountRef.current.set(tab.id, 0);
        streamStartTimeRef.current.delete(tab.id);
        lastMsgTimeRef.current.delete(tab.id);
      } else if (!tab.isStreaming) {
        msgCountRef.current.delete(tab.id);
        streamStartTimeRef.current.delete(tab.id);
        lastMsgTimeRef.current.delete(tab.id);
      }
    }
  }, [tabs]);

  useEffect(() => {
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenComplete: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;

    async function registerProposedChange(
      filePath: string,
      toolUseId: string,
      toolName: string,
    ) {
      const docState = useDocumentStore.getState();
      const projectRoot = docState.projectRoot;
      let relativePath = filePath;
      if (projectRoot && filePath.startsWith(projectRoot)) {
        relativePath = filePath.slice(projectRoot.length).replace(/^\//, "");
      }
      const file = docState.files.find(
        (f) => f.relativePath === relativePath || f.absolutePath === filePath,
      );
      if (!file) return;

      const oldContent = file.content ?? "";
      try {
        const newContent = await readTexFileContent(file.absolutePath);
        if (oldContent !== newContent) {
          useProposedChangesStore.getState().addChange({
            id: toolUseId,
            filePath: file.relativePath,
            absolutePath: file.absolutePath,
            oldContent,
            newContent,
            toolName,
          });
        }
      } catch {
        // read failed — not critical
      }
    }

    async function setup() {
      unlistenOutput = await listen<AiOutputPayload>("ai-output", (event) => {
        const { tab_id: tabId, data, provider } = event.payload;
        const chatStore = useClaudeChatStore.getState();
        const tab = chatStore.tabs.find((t) => t.id === tabId);
        if (!tab?.isStreaming) return;

        const count = (msgCountRef.current.get(tabId) ?? 0) + 1;
        msgCountRef.current.set(tabId, count);
        const now = performance.now();
        if (count === 1) streamStartTimeRef.current.set(tabId, now);
        lastMsgTimeRef.current.set(tabId, now);

        // For Claude CLI provider, data is stream-json (parse as ClaudeStreamMessage).
        // For API providers, data is raw SSE — append as-is for provider-specific rendering.
        if (provider === "claude-cli") {
          let msg: ClaudeStreamMessage;
          try {
            msg = JSON.parse(data);
          } catch {
            return;
          }

          // Track tool uses for proposed changes
          if (msg.type === "assistant") {
            const toolBlocks = msg.message?.content?.filter(
              (b: any) => b.type === "tool_use",
            );
            if (toolBlocks) {
              for (const block of toolBlocks) {
                const pending =
                  pendingToolUsesRef.current.get(tabId) ?? new Map();
                pending.set(block.id, {
                  name: block.name,
                  input: block.input,
                });
                pendingToolUsesRef.current.set(tabId, pending);
              }
            }
          }

          if (msg.type === "user") {
            const toolBlocks = msg.message?.content?.filter(
              (b: any) => b.type === "tool_result",
            );
            if (toolBlocks) {
              for (const block of toolBlocks) {
                const pending = pendingToolUsesRef.current.get(tabId);
                const toolUse = pending?.get(block.tool_use_id);
                if (toolUse) {
                  const editTools = [
                    "write_to_file",
                    "write",
                    "replace_in_file",
                    "edit",
                  ];
                  if (editTools.includes(toolUse.name)) {
                    const input = toolUse.input as any;
                    const filePath = input?.file_path ?? input?.filePath;
                    if (filePath) {
                      registerProposedChange(
                        filePath,
                        block.tool_use_id,
                        toolUse.name,
                      );
                    }
                  }
                  pending.delete(block.tool_use_id);
                }
              }
            }
          }

          if (
            msg.type === "assistant" &&
            msg.message?.content?.some((b: any) => {
              if (b.type !== "tool_use") return false;
              const input = b.input ?? {};
              return Object.values(input ?? {}).some(
                (v) => typeof v === "string" && v.includes(".tex"),
              );
            })
          ) {
            hasTexChangesRef.current.set(tabId, true);
          }

          if (msg.type === "assistant") {
            const askBlock = msg.message?.content?.find(
              (b: any) => b.type === "tool_use" && b.name === "AskUserQuestion",
            );
            if (askBlock) {
              cancelledForAskRef.current.set(tabId, true);
            }
          }

          chatStore._appendMessage(tabId, msg);

          if (
            msg.type === "system" &&
            msg.subtype === "init" &&
            msg.session_id
          ) {
            chatStore._setSessionId(tabId, msg.session_id);
          }

          if (msg.usage) {
            chatStore._appendMessage(tabId, {
              type: "system",
              subtype: "usage",
              usage: msg.usage,
            } as ClaudeStreamMessage);
          }
        } else if (provider === "anthropic") {
          // Parse Anthropic SSE events
          let state = anthropicStateRef.current.get(tabId);
          if (!state) {
            state = createAnthropicStreamState();
            anthropicStateRef.current.set(tabId, state);
          }
          const messages = parseAnthropicSSE(data, state);
          for (const msg of messages) {
            chatStore._appendMessage(tabId, msg);
            if (msg.message?.content?.some((b: any) => b.type === "tool_use")) {
              hasTexChangesRef.current.set(tabId, true);
            }
          }
        } else if (provider === "openai") {
          // Parse OpenAI SSE events
          let state = openaiStateRef.current.get(tabId);
          if (!state) {
            state = createOpenAIStreamState();
            openaiStateRef.current.set(tabId, state);
          }
          const messages = parseOpenAISSE(data, state);
          for (const msg of messages) {
            chatStore._appendMessage(tabId, msg);
            if (msg.message?.content?.some((b: any) => b.type === "tool_use")) {
              hasTexChangesRef.current.set(tabId, true);
            }
          }
        } else {
          // Unknown provider — skip
        }
      });

      unlistenComplete = await listen<AiCompletePayload>(
        "ai-complete",
        async (event) => {
          const { tab_id: tabId, success } = event.payload;
          const chatStore = useClaudeChatStore.getState();

          chatStore._setStreaming(tabId, false);

          if (!success && !cancelledForAskRef.current.get(tabId)) {
            chatStore._setError(tabId, "AI process exited with an error");
          }

          cancelledForAskRef.current.delete(tabId);
          msgCountRef.current.delete(tabId);
          streamStartTimeRef.current.delete(tabId);
          lastMsgTimeRef.current.delete(tabId);
          anthropicStateRef.current.delete(tabId);
          openaiStateRef.current.delete(tabId);

          if (hasTexChangesRef.current.get(tabId)) {
            hasTexChangesRef.current.delete(tabId);
            try {
              const docState = useDocumentStore.getState();
              const projectRoot = docState.projectRoot;
              if (projectRoot) {
                const target = await resolveCompileTarget(projectRoot);
                if (target) {
                  const result = await compileLatex(
                    projectRoot,
                    target,
                    useDocumentStore.getState().compilerBackend,
                  );
                  if (result.success && result.pdfBytes) {
                    docState.setCompilationResult(
                      projectRoot,
                      result.pdfBytes,
                      result.log,
                    );
                  } else if (!result.success && result.log) {
                    docState.setCompileError(formatCompileError(result.log));
                  }
                }
              }
            } catch {
              // compilation failure is non-critical
            }
            try {
              await useHistoryStore
                .getState()
                .createSnapshot(
                  useDocumentStore.getState().projectRoot ?? "",
                  "[ai] After AI edit",
                );
            } catch {
              // snapshot failure is non-critical
            }
          }
        },
      );

      unlistenError = await listen<AiErrorPayload>("ai-error", (event) => {
        const { tab_id: tabId, data } = event.payload;
        log.error(`[${tabId}] ${data}`);
      });
    }

    setup();

    return () => {
      if (unlistenOutput) unlistenOutput();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, []);
}
