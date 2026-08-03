import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "./document-store";
import { useHistoryStore } from "./history-store";
import { useProposedChangesStore } from "./proposed-changes-store";
import { createLogger } from "@/lib/debug/logger";
import type { AiRequest, AiContext, AiMessage } from "@/lib/ai/types";
import { AI_TOOL_DEFINITIONS, executeAiTool } from "@/lib/ai/tools";
import { useSkillsStore } from "./skills-store";
import { usePendingScriptsStore } from "./pending-scripts-store";
import type { Skill } from "@/lib/skills/types";

const log = createLogger("ai-chat");

/** Max assistant↔tool round-trips per user prompt before we bail out */
const MAX_TOOL_ITERATIONS = 8;

/** Per-tab count of tool round-trips for the current prompt */
const toolIterations = new Map<string, number>();

/** Convert a character offset to 1-based line:col */
export function offsetToLineCol(
  content: string,
  offset: number,
): { line: number; col: number } {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

/**
 * Convert AiStreamMessage history to generic AiMessage[] for API providers.
 * Skips incremental streaming deltas (superseded by complete blocks) and
 * merges consecutive same-role messages into one — Anthropic requires
 * strictly alternating user/assistant roles. Duplicate tool_use / tool_result
 * blocks (same id) are dropped: providers reject duplicate tool_call_ids, and
 * a transcript can contain duplicates (e.g. from historic double-registered
 * event listeners).
 */
export function toAiMessages(msgs: AiStreamMessage[]): AiMessage[] {
  const result: AiMessage[] = [];
  const seenToolUseIds = new Set<string>();
  const seenToolResultIds = new Set<string>();

  const dedupe = (blocks: ContentBlock[]): ContentBlock[] =>
    blocks.filter((b) => {
      if (b.type === "tool_use" && b.id) {
        if (seenToolUseIds.has(b.id)) return false;
        seenToolUseIds.add(b.id);
      }
      if (b.type === "tool_result" && b.tool_use_id) {
        if (seenToolResultIds.has(b.tool_use_id)) return false;
        seenToolResultIds.add(b.tool_use_id);
      }
      return true;
    });

  for (const msg of msgs) {
    if (msg.type !== "user" && msg.type !== "assistant") continue;
    if (msg.subtype === "delta") continue;
    const content = msg.message?.content;
    if (!Array.isArray(content) || content.length === 0) continue;
    const blocks = dedupe(content);
    if (blocks.length === 0) continue;
    const prev = result[result.length - 1];
    if (prev && prev.role === msg.type) {
      prev.content = [
        ...(prev.content ?? []),
        ...blocks,
      ] as AiMessage["content"];
    } else {
      result.push({
        role: msg.type,
        content: blocks as AiMessage["content"],
      });
    }
  }

  // OpenAI-compatible APIs (including DeepSeek) require every assistant
  // tool_use block to be followed immediately by a matching tool_result.
  // Interrupted/cancelled streams can leave either side orphaned in persisted
  // chat history. Drop only the orphaned blocks and retain any text that was
  // part of the same turn.
  const pairedToolIds = new Set<string>();
  for (let index = 0; index < result.length - 1; index += 1) {
    const assistant = result[index];
    const user = result[index + 1];
    if (assistant.role !== "assistant" || user.role !== "user") continue;

    const resultIds = new Set(
      (user.content ?? [])
        .filter((block) => block.type === "tool_result")
        .map((block) => block.tool_use_id),
    );
    for (const block of assistant.content ?? []) {
      if (block.type === "tool_use" && resultIds.has(block.id)) {
        pairedToolIds.add(block.id);
      }
    }
  }

  const repaired = result
    .map((message) => ({
      ...message,
      content: message.content?.filter((block) => {
        if (block.type === "tool_use") return pairedToolIds.has(block.id);
        if (block.type === "tool_result") {
          return pairedToolIds.has(block.tool_use_id);
        }
        return true;
      }),
    }))
    .filter((message) => (message.content?.length ?? 0) > 0);

  // Removing an orphan-only turn can expose consecutive messages with the
  // same role, so compact once more to preserve Anthropic role alternation.
  const compacted: AiMessage[] = [];
  for (const message of repaired) {
    const previous = compacted[compacted.length - 1];
    if (previous?.role === message.role) {
      previous.content = [
        ...(previous.content ?? []),
        ...(message.content ?? []),
      ];
    } else {
      compacted.push(message);
    }
  }
  return compacted;
}

export interface ModelInfo {
  id: string;
  name: string;
  desc: string;
}

export function getModelsForProvider(providerId: string): ModelInfo[] {
  switch (providerId) {
    case "anthropic":
      return [
        {
          id: "claude-sonnet-5",
          name: "Sonnet 5",
          desc: "Fast and capable — best for most tasks",
        },
        {
          id: "claude-opus-4-8",
          name: "Opus 4.8",
          desc: "Most capable, complex reasoning",
        },
        {
          id: "claude-haiku-4-5",
          name: "Haiku 4.5",
          desc: "Fastest, simple tasks",
        },
      ];
    case "openai":
      return [
        { id: "gpt-5.1", name: "GPT-5.1", desc: "Most capable" },
        { id: "gpt-5-mini", name: "GPT-5 Mini", desc: "Fast, efficient" },
        { id: "gpt-5-nano", name: "GPT-5 Nano", desc: "Fastest, simple tasks" },
      ];
    default:
      return [];
  }
}

// ─── Types ───

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  // text block
  text?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: any;
  // tool_result block
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
  // thinking block
  thinking?: string;
  signature?: string;
}

export interface AiStreamMessage {
  type: "system" | "assistant" | "user" | "result";
  subtype?: string;
  session_id?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  message?: {
    content?: ContentBlock[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  usage?: { input_tokens: number; output_tokens: number };
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  result?: string;
  is_error?: boolean;
  num_turns?: number;
}

// ─── Tab Types ───

export interface TabDraft {
  input: string;
  pinnedContexts: {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }[];
}

export interface TabState {
  id: string;
  title: string;
  sessionId: string | null;
  messages: AiStreamMessage[];
  isStreaming: boolean;
  error: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  draft: TabDraft;
  /**
   * Name of the skill active for this tab, or null for plain chat. Sticky: a
   * skill is a working mode, not a per-message decoration, so it survives
   * until the user clears it.
   */
  activeSkillName: string | null;
}

/** Fields that are projected from the active tab to top-level state */
const TAB_FIELDS = [
  "sessionId",
  "messages",
  "isStreaming",
  "error",
  "totalInputTokens",
  "totalOutputTokens",
  "activeSkillName",
] as const;

function makeDefaultTab(id: string): TabState {
  return {
    id,
    title: "New Chat",
    sessionId: null,
    messages: [],
    isStreaming: false,
    error: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    draft: { input: "", pinnedContexts: [] },
    activeSkillName: null,
  };
}

let tabCounter = 0;
function nextTabId(): string {
  return `tab-${++tabCounter}`;
}

/**
 * Update a specific tab in `tabs[]` and, if that tab is the active tab,
 * also project the changed fields to top-level state for consumer compatibility.
 */
function applyTabUpdate(
  state: AiChatState,
  tabId: string,
  updates: Partial<TabState>,
): Partial<AiChatState> {
  const newTabs = state.tabs.map((t) =>
    t.id === tabId ? { ...t, ...updates } : t,
  );
  const result: Partial<AiChatState> = { tabs: newTabs };
  if (tabId === state.activeTabId) {
    for (const key of TAB_FIELDS) {
      if (key in updates) {
        (result as any)[key] = (updates as any)[key];
      }
    }
  }
  return result;
}

// ─── Skills ───

/**
 * Resolve the skill a tab has active. Returns undefined for plain chat, and
 * also when the tab names a skill that no longer exists — a file the user
 * deleted or renamed between activating it and sending. The send proceeds as
 * plain chat rather than failing, but it is logged: silently dropping a working
 * mode is worse than a noisy one.
 */
function resolveActiveSkill(tab: TabState | undefined): Skill | undefined {
  if (!tab?.activeSkillName) return undefined;
  const skill = useSkillsStore.getState().getSkill(tab.activeSkillName);
  if (!skill) {
    log.warn("active skill not found — sending as plain chat", {
      skill: tab.activeSkillName,
      tab: tab.id,
    });
  }
  return skill;
}

/**
 * The tools an active skill permits. A skill may only *narrow* the surface:
 * an absent `tools` list means all tools, and an empty one means none.
 */
function toolsForSkill(skill: Skill | undefined) {
  if (!skill?.tools) return AI_TOOL_DEFINITIONS;
  const allowed = new Set(skill.tools);
  return AI_TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
}

/**
 * Build the request handed to Rust. Both the initial prompt and every tool-loop
 * continuation go through here, so an active skill — and its tool allowlist —
 * cannot silently disappear part-way through an agent loop.
 */
function buildAiRequest(params: {
  tabId: string;
  projectPath: string;
  prompt: string;
  model: string;
  messages: AiMessage[];
  context?: AiContext;
  skill?: Skill;
}): AiRequest {
  const { skill } = params;
  return {
    tabId: params.tabId,
    projectPath: params.projectPath,
    prompt: params.prompt,
    model: params.model,
    messages: params.messages,
    context: params.context,
    // Appended to the base system prompt on the Rust side, never replacing it
    skillPrompt: skill?.body,
    tools: toolsForSkill(skill),
  };
}

// ─── State Interface ───

const DEFAULT_TAB_ID = nextTabId();

interface AiChatState {
  // ── Projected fields (from active tab — read by consumers) ──
  messages: AiStreamMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  error: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Skill active for the current tab, or null for plain chat */
  activeSkillName: string | null;

  // ── Tab state ──
  tabs: TabState[];
  activeTabId: string;

  /** Deferred prompt to send once the workspace is ready (set by project wizard) */
  pendingInitialPrompt: string | null;
  setPendingInitialPrompt: (prompt: string | null) => void;
  consumePendingInitialPrompt: () => string | null;

  /** Pending attachments from external sources (e.g. PDF capture) */
  pendingAttachments: {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }[];
  addPendingAttachment: (attachment: {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }) => void;
  consumePendingAttachments: () => {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }[];

  /** Currently selected model (passed per-prompt) */
  selectedModel: string;
  setSelectedModel: (model: string) => void;

  /**
   * Activate a skill for a tab (defaults to the active tab), or clear it with
   * null. A skill that declares a `model` switches the picker to it; the user
   * can still change it afterwards.
   */
  setActiveSkill: (skillName: string | null, tabId?: string) => void;

  // Actions
  sendPrompt: (
    userPrompt: string,
    contextOverride?: { label: string; filePath: string; selectedText: string },
    aiContext?: AiContext,
  ) => Promise<void>;
  cancelExecution: () => Promise<void>;
  clearMessages: () => void;
  newSession: () => void;

  // Tab actions
  createTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  saveDraft: (tabId: string, draft: TabDraft) => void;

  /** True when any tab is streaming */
  anyStreaming: () => boolean;

  // Internal actions (called by event hook, routed by tabId)
  _appendMessage: (tabId: string, msg: AiStreamMessage) => void;
  _setSessionId: (tabId: string, id: string) => void;
  _setStreaming: (tabId: string, streaming: boolean) => void;
  _setError: (tabId: string, error: string | null) => void;
  /**
   * Called when a provider turn finishes successfully. If the turn ended with
   * unanswered tool calls, executes them and continues the conversation;
   * otherwise finalizes the stream.
   */
  _handleTurnComplete: (tabId: string) => Promise<void>;
  _cancelledByUser: boolean;
}

// ─── Store ───

export const useAiChatStore = create<AiChatState>()((set, get) => ({
  // Projected fields (initialized from default tab)
  messages: [],
  sessionId: null,
  isStreaming: false,
  error: null,
  _cancelledByUser: false,
  totalInputTokens: 0,
  totalOutputTokens: 0,

  // Tab state
  tabs: [makeDefaultTab(DEFAULT_TAB_ID)],
  activeTabId: DEFAULT_TAB_ID,

  activeSkillName: null,

  selectedModel: "claude-sonnet-5",
  setSelectedModel: (model) => set({ selectedModel: model }),

  setActiveSkill: (skillName, tabId) => {
    const targetTabId = tabId ?? get().activeTabId;
    set((s) => applyTabUpdate(s, targetTabId, { activeSkillName: skillName }));

    if (!skillName) return;
    const model = useSkillsStore.getState().getSkill(skillName)?.model;
    if (model) set({ selectedModel: model });
  },

  pendingInitialPrompt: null,
  setPendingInitialPrompt: (prompt) => set({ pendingInitialPrompt: prompt }),
  consumePendingInitialPrompt: () => {
    const { pendingInitialPrompt } = get();
    if (pendingInitialPrompt) {
      set({ pendingInitialPrompt: null });
    }
    return pendingInitialPrompt;
  },

  pendingAttachments: [],
  addPendingAttachment: (attachment) => {
    set((state) => ({
      pendingAttachments: [...state.pendingAttachments, attachment],
    }));
  },
  consumePendingAttachments: () => {
    const { pendingAttachments } = get();
    if (pendingAttachments.length > 0) {
      set({ pendingAttachments: [] });
    }
    return pendingAttachments;
  },

  anyStreaming: () => get().tabs.some((t) => t.isStreaming),

  sendPrompt: async (
    userPrompt: string,
    contextOverride?: { label: string; filePath: string; selectedText: string },
    aiContext?: AiContext,
  ) => {
    const state = get();
    const { activeTabId } = state;
    const activeTab = state.tabs.find((t) => t.id === activeTabId);
    // Guard: prevent sending from a tab that's already streaming
    if (activeTab?.isStreaming) return;

    const { sessionId, selectedModel } = state;

    const sendStart = performance.now();
    log.info("sendPrompt start", {
      sessionId: !!sessionId,
      hasContext: !!contextOverride,
      tab: activeTabId,
    });

    const docState = useDocumentStore.getState();
    const projectPath = docState.projectRoot;
    if (!projectPath) {
      set((s) => applyTabUpdate(s, activeTabId, { error: "No project open" }));
      return;
    }

    // Compute context label for display in chat history
    const activeFile = docState.files.find(
      (f) => f.id === docState.activeFileId,
    );
    let contextLabel: string | null = null;

    if (contextOverride) {
      contextLabel = contextOverride.label;
    } else if (activeFile) {
      const selRange = docState.selectionRange;
      if (selRange && activeFile.content) {
        const content = activeFile.content;
        const startLC = offsetToLineCol(content, selRange.start);
        const endLC = offsetToLineCol(content, selRange.end);
        contextLabel = `@${activeFile.relativePath}:${startLC.line}:${startLC.col}-${endLC.line}:${endLC.col}`;
      }
    }

    // Add user message to the list for display (with context label visible)
    const displayText = contextLabel
      ? `${contextLabel}\n${userPrompt}`
      : userPrompt;
    const userMessage: AiStreamMessage = {
      type: "user",
      message: {
        content: [{ type: "text", text: displayText }],
      },
    };

    // Auto-set tab title from first prompt
    const isFirstMessage = activeTab && activeTab.messages.length === 0;
    const tabTitle = isFirstMessage
      ? userPrompt.slice(0, 40) + (userPrompt.length > 40 ? "..." : "")
      : undefined;

    set((s) => {
      const tabUpdates: Partial<TabState> = {
        messages: [
          ...(s.tabs.find((t) => t.id === activeTabId)?.messages ?? []),
          userMessage,
        ],
        isStreaming: true,
        error: null,
      };
      if (tabTitle) tabUpdates.title = tabTitle;
      return {
        ...applyTabUpdate(s, activeTabId, tabUpdates),
        _cancelledByUser: false,
      };
    });

    // Fresh prompt — reset the tool round-trip counter
    toolIterations.set(activeTabId, 0);

    // Flush unsaved edits to disk so the selected AI provider reads the latest content
    if (docState.files.some((f) => f.isDirty)) {
      log.debug("saving dirty files...");
      await docState.saveAllFiles();
      log.debug("saveAllFiles done");
    }

    // Snapshot before AI edit
    if (projectPath) {
      try {
        log.debug("creating snapshot...");
        await useHistoryStore
          .getState()
          .createSnapshot(projectPath, "[ai] Before AI edit");
        log.debug("snapshot done");
      } catch {
        /* snapshot failure should not block AI */
      }
    }

    // Build prompt with the selected editor context
    let prompt = userPrompt;
    if (activeFile) {
      const selRange = docState.selectionRange;
      const selectedText =
        selRange && activeFile.content
          ? activeFile.content.slice(selRange.start, selRange.end)
          : null;
      let ctx = `[Currently open file: ${activeFile.relativePath}]`;
      if (contextOverride) {
        ctx += `\n[Selection: ${contextOverride.label}]`;
        ctx += `\n[Selected text:\n${contextOverride.selectedText}\n]`;
      } else if (selectedText && selRange) {
        const content = activeFile.content ?? "";
        const startLC = offsetToLineCol(content, selRange.start);
        const endLC = offsetToLineCol(content, selRange.end);
        ctx += `\n[Selection: @${activeFile.relativePath}:${startLC.line}:${startLC.col}-${endLC.line}:${endLC.col}]`;
        ctx += `\n[Selected text:\n${selectedText}\n]`;
      }
      prompt = `${ctx}\n\n${userPrompt}`;
    }
    log.info("invoking CLI", {
      promptLength: prompt.length,
      mode: sessionId ? "resume" : "new",
    });

    try {
      const aiRequest = buildAiRequest({
        tabId: activeTabId,
        projectPath,
        prompt,
        model: selectedModel,
        messages: toAiMessages(activeTab?.messages ?? []),
        context:
          aiContext ??
          (contextOverride
            ? {
                scope: "selection",
                files: [contextOverride.filePath],
                action: "chat",
                selection: contextOverride.selectedText,
              }
            : activeFile
              ? {
                  scope: "selection",
                  files: [activeFile.relativePath],
                  action: "chat",
                }
              : {
                  scope: "project",
                  files: [],
                  action: "chat",
                }),
        skill: resolveActiveSkill(activeTab),
      });

      await invoke("ai_execute", { request: aiRequest });
      log.info(
        `sendPrompt complete in ${(performance.now() - sendStart).toFixed(0)}ms`,
      );
    } catch (err: any) {
      log.error(
        `sendPrompt failed after ${(performance.now() - sendStart).toFixed(0)}ms`,
        { error: String(err) },
      );
      set((s) =>
        applyTabUpdate(s, activeTabId, {
          isStreaming: false,
          error: err?.message || String(err),
        }),
      );
    }
  },

  cancelExecution: async () => {
    const { activeTabId } = get();
    set({ _cancelledByUser: true });
    // A paused run_python call would otherwise keep waiting on a prompt for a
    // turn the user has already abandoned.
    usePendingScriptsStore.getState().rejectAll();
    try {
      await invoke("ai_cancel", { tabId: activeTabId });
    } catch {
      // ignore
    }
    set((s) => applyTabUpdate(s, activeTabId, { isStreaming: false }));
  },

  clearMessages: () => {
    const { activeTabId } = get();
    set((s) =>
      applyTabUpdate(s, activeTabId, {
        messages: [],
        error: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }),
    );
  },

  newSession: () => {
    log.info("Starting new session");
    const { activeTabId } = get();
    set((s) =>
      applyTabUpdate(s, activeTabId, {
        messages: [],
        sessionId: null,
        error: null,
        isStreaming: false,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        title: "New Chat",
      }),
    );
  },

  // ─── Tab Actions ───

  createTab: () => {
    log.debug("Creating new tab");
    const id = nextTabId();
    const newTab = makeDefaultTab(id);
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabId: id,
      // Project new tab fields to top-level
      messages: newTab.messages,
      sessionId: newTab.sessionId,
      isStreaming: newTab.isStreaming,
      error: newTab.error,
      totalInputTokens: newTab.totalInputTokens,
      totalOutputTokens: newTab.totalOutputTokens,
    }));
    return id;
  },

  closeTab: (tabId: string) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    // Prevent closing a streaming tab
    if (tab?.isStreaming) return;
    // Prevent closing the last tab
    if (state.tabs.length <= 1) return;

    const idx = state.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const newTabs = state.tabs.filter((t) => t.id !== tabId);

    if (tabId === state.activeTabId) {
      // Switch to adjacent tab
      const newIdx = Math.min(idx, newTabs.length - 1);
      const newActive = newTabs[newIdx];
      set({
        tabs: newTabs,
        activeTabId: newActive.id,
        // Project new active tab
        messages: newActive.messages,
        sessionId: newActive.sessionId,
        isStreaming: newActive.isStreaming,
        error: newActive.error,
        totalInputTokens: newActive.totalInputTokens,
        totalOutputTokens: newActive.totalOutputTokens,
      });
    } else {
      set({ tabs: newTabs });
    }
  },

  setActiveTab: (tabId: string) => {
    const state = get();
    if (tabId === state.activeTabId) return;
    const targetTab = state.tabs.find((t) => t.id === tabId);
    if (!targetTab) return;

    // Project the target tab's fields to top-level
    set({
      activeTabId: tabId,
      messages: targetTab.messages,
      sessionId: targetTab.sessionId,
      isStreaming: targetTab.isStreaming,
      error: targetTab.error,
      totalInputTokens: targetTab.totalInputTokens,
      totalOutputTokens: targetTab.totalOutputTokens,
      activeSkillName: targetTab.activeSkillName,
    });
  },

  saveDraft: (tabId: string, draft: TabDraft) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, draft } : t)),
    }));
  },

  // ─── Internal Actions (routed by explicit tabId) ───

  _appendMessage: (tabId: string, msg: AiStreamMessage) => {
    set((state) => {
      let inputDelta = 0;
      let outputDelta = 0;
      const usage = msg.usage || msg.message?.usage;
      if (usage) {
        inputDelta = usage.input_tokens || 0;
        outputDelta = usage.output_tokens || 0;
      }

      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return {};

      // A complete (non-delta) assistant block supersedes the incremental
      // delta messages that streamed it — drop the trailing deltas so the
      // transcript holds exactly one copy of the text.
      let messages = tab.messages;
      if (msg.type === "assistant" && msg.subtype !== "delta") {
        let end = messages.length;
        while (
          end > 0 &&
          messages[end - 1].type === "assistant" &&
          messages[end - 1].subtype === "delta"
        ) {
          end--;
        }
        if (end < messages.length) messages = messages.slice(0, end);
      }

      return applyTabUpdate(state, tabId, {
        messages: [...messages, msg],
        totalInputTokens: tab.totalInputTokens + inputDelta,
        totalOutputTokens: tab.totalOutputTokens + outputDelta,
      });
    });
  },

  _setSessionId: (tabId: string, id: string) => {
    set((state) => applyTabUpdate(state, tabId, { sessionId: id }));
  },

  _setStreaming: (tabId: string, streaming: boolean) => {
    set((state) => applyTabUpdate(state, tabId, { isStreaming: streaming }));
  },

  _setError: (tabId: string, error: string | null) => {
    set((state) => applyTabUpdate(state, tabId, { error }));
  },

  _handleTurnComplete: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    // Cancelled (isStreaming already false) or tab gone — nothing to do
    if (!tab || !tab.isStreaming) return;

    // Collect tool calls from the trailing assistant messages (i.e. after the
    // last user / tool_result message) — these have no results yet. Dedupe by
    // id so a call never executes twice.
    const pendingCalls: ContentBlock[] = [];
    const seenCallIds = new Set<string>();
    for (let i = tab.messages.length - 1; i >= 0; i--) {
      const m = tab.messages[i];
      if (m.type === "user") break;
      if (m.type === "assistant" && Array.isArray(m.message?.content)) {
        const calls: ContentBlock[] = [];
        for (const b of m.message.content) {
          if (b.type !== "tool_use" || !b.id || !b.name) continue;
          if (seenCallIds.has(b.id)) continue;
          seenCallIds.add(b.id);
          calls.push(b);
        }
        pendingCalls.unshift(...calls);
      }
    }

    if (pendingCalls.length === 0) {
      set((s) => applyTabUpdate(s, tabId, { isStreaming: false }));
      // If the turn left proposed edits in files other than the active one,
      // bring the first into view so the review UI is visible.
      const changes = useProposedChangesStore.getState().changes;
      if (changes.length > 0) {
        const doc = useDocumentStore.getState();
        const activeFile = doc.files.find((f) => f.id === doc.activeFileId);
        const activeHasChange = changes.some(
          (c) => c.filePath === activeFile?.relativePath,
        );
        if (!activeHasChange) {
          const target = changes.find((c) =>
            doc.files.some((f) => f.relativePath === c.filePath),
          );
          if (target) doc.setActiveFile(target.filePath);
        }
      }
      return;
    }

    const iteration = (toolIterations.get(tabId) ?? 0) + 1;
    toolIterations.set(tabId, iteration);
    if (iteration > MAX_TOOL_ITERATIONS) {
      log.error(`Tool iteration limit reached for tab ${tabId}`);
      set((s) =>
        applyTabUpdate(s, tabId, {
          isStreaming: false,
          error:
            "Tool call limit reached — send a follow-up message to continue.",
        }),
      );
      return;
    }

    log.info(`Executing ${pendingCalls.length} tool call(s)`, {
      iteration,
      tools: pendingCalls.map((c) => c.name),
    });

    const activeSkill = resolveActiveSkill(tab);
    const permittedTools = new Set(
      toolsForSkill(activeSkill).map((t) => t.name),
    );

    const results: ContentBlock[] = [];
    for (const call of pendingCalls) {
      // The provider was only offered the permitted tools, but enforce it on
      // execution too: a skill's allowlist is a guarantee about what that skill
      // can do, not a hint the model is trusted to respect.
      if (!permittedTools.has(call.name!)) {
        log.warn("blocked a tool call outside the active skill's allowlist", {
          tool: call.name,
          skill: activeSkill?.name,
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id!,
          content: `The "${call.name}" tool is not available in the "${activeSkill?.title ?? "current"}" skill. Do not try to call it again.`,
          is_error: true,
        });
        continue;
      }
      const res = await executeAiTool(call.name!, call.input, call.id!);
      results.push({
        type: "tool_result",
        tool_use_id: call.id!,
        content: res.content,
        is_error: res.isError || undefined,
      });
    }

    // Append the results as a user message (hidden in the transcript; the
    // ToolWidget picks them up via tool_use_id for inline display).
    set((s) => {
      const t = s.tabs.find((t) => t.id === tabId);
      if (!t) return {};
      return applyTabUpdate(s, tabId, {
        messages: [
          ...t.messages,
          { type: "user", message: { content: results } },
        ],
      });
    });

    // Re-check cancellation after async tool execution
    const current = get().tabs.find((t) => t.id === tabId);
    if (!current || !current.isStreaming) return;

    const projectPath = useDocumentStore.getState().projectRoot;
    if (!projectPath) {
      set((s) =>
        applyTabUpdate(s, tabId, {
          isStreaming: false,
          error: "No project open",
        }),
      );
      return;
    }

    const request = buildAiRequest({
      tabId,
      projectPath,
      prompt: "", // continuation — the tool results are already in messages
      model: get().selectedModel,
      messages: toAiMessages(current.messages),
      skill: resolveActiveSkill(current),
    });

    try {
      await invoke("ai_execute", { request });
    } catch (err: any) {
      log.error("Tool-loop continuation failed", { error: String(err) });
      set((s) =>
        applyTabUpdate(s, tabId, {
          isStreaming: false,
          error: err?.message || String(err),
        }),
      );
    }
  },
}));
