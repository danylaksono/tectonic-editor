import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  useAiChatStore,
  toAiMessages,
  type AiStreamMessage,
  type TabState,
} from "@/stores/ai-chat-store";
import { useDocumentStore } from "@/stores/document-store";

function makeTab(id: string, overrides: Partial<TabState> = {}): TabState {
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
    ...overrides,
  };
}

function setTabs(tabs: TabState[], activeTabId = tabs[0].id) {
  const active = tabs.find((t) => t.id === activeTabId)!;
  useAiChatStore.setState({
    tabs,
    activeTabId,
    messages: active.messages,
    isStreaming: active.isStreaming,
    error: active.error,
    selectedModel: "claude-sonnet-5",
  });
}

const userMsg = (text: string): AiStreamMessage => ({
  type: "user",
  message: { content: [{ type: "text", text }] },
});

const assistantText = (text: string): AiStreamMessage => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});

const assistantDelta = (text: string): AiStreamMessage => ({
  type: "assistant",
  subtype: "delta",
  message: { content: [{ type: "text", text }] },
});

const assistantToolUse = (id: string, name: string, input: any = {}) =>
  ({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  }) as AiStreamMessage;

beforeEach(() => {
  vi.clearAllMocks();
  // The logger fire-and-forgets invoke("js_log").catch(...), so the mock must
  // return a promise rather than undefined
  vi.mocked(invoke).mockResolvedValue(undefined);
  useDocumentStore.setState({
    projectRoot: "/project",
    files: [
      {
        id: "main.tex",
        name: "main.tex",
        relativePath: "main.tex",
        absolutePath: "/project/main.tex",
        type: "tex",
        content: "\\documentclass{article}",
        isDirty: false,
      },
    ],
  } as any);
});

describe("toAiMessages", () => {
  it("skips streaming deltas and system messages", () => {
    const msgs: AiStreamMessage[] = [
      userMsg("hi"),
      assistantDelta("par"),
      assistantDelta("tial"),
      assistantText("complete answer"),
      { type: "system", subtype: "usage" } as AiStreamMessage,
    ];
    const result = toAiMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[1].content).toEqual([
      { type: "text", text: "complete answer" },
    ]);
  });

  it("merges consecutive same-role messages for role alternation", () => {
    const msgs: AiStreamMessage[] = [
      userMsg("hi"),
      assistantText("thinking about it"),
      assistantToolUse("tu1", "read_file", { path: "main.tex" }),
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu1", content: "x" }],
        },
      },
    ];
    const result = toAiMessages(msgs);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // The two assistant messages merged into one with both blocks
    expect(result[1].content).toHaveLength(2);
    expect(result[1].content?.[0]).toMatchObject({ type: "text" });
    expect(result[1].content?.[1]).toMatchObject({
      type: "tool_use",
      id: "tu1",
    });
  });
});

describe("_appendMessage delta replacement", () => {
  it("replaces trailing deltas with the complete block", () => {
    setTabs([makeTab("t1", { isStreaming: true, messages: [userMsg("hi")] })]);
    const store = useAiChatStore.getState();
    store._appendMessage("t1", assistantDelta("Hel"));
    store._appendMessage("t1", assistantDelta("lo"));
    store._appendMessage("t1", assistantText("Hello"));

    const tab = useAiChatStore.getState().tabs.find((t) => t.id === "t1")!;
    expect(tab.messages).toHaveLength(2); // user + complete assistant
    expect(tab.messages[1].subtype).toBeUndefined();
    expect(tab.messages[1].message?.content?.[0].text).toBe("Hello");
  });

  it("does not strip completed blocks when a tool_use block follows", () => {
    setTabs([makeTab("t1", { isStreaming: true, messages: [userMsg("hi")] })]);
    const store = useAiChatStore.getState();
    store._appendMessage("t1", assistantDelta("Hel"));
    store._appendMessage("t1", assistantText("Hello"));
    store._appendMessage("t1", assistantToolUse("tu1", "list_files"));

    const tab = useAiChatStore.getState().tabs.find((t) => t.id === "t1")!;
    expect(tab.messages).toHaveLength(3);
    expect(tab.messages[1].message?.content?.[0].text).toBe("Hello");
    expect(tab.messages[2].message?.content?.[0].type).toBe("tool_use");
  });
});

describe("_handleTurnComplete", () => {
  it("finalizes the stream when there are no pending tool calls", async () => {
    setTabs([
      makeTab("t1", {
        isStreaming: true,
        messages: [userMsg("hi"), assistantText("done")],
      }),
    ]);
    await useAiChatStore.getState()._handleTurnComplete("t1");

    const tab = useAiChatStore.getState().tabs.find((t) => t.id === "t1")!;
    expect(tab.isStreaming).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("executes pending tool calls and continues the conversation", async () => {
    setTabs([
      makeTab("t2", {
        isStreaming: true,
        messages: [
          userMsg("list my files"),
          assistantToolUse("tu1", "list_files"),
        ],
      }),
    ]);
    await useAiChatStore.getState()._handleTurnComplete("t2");

    const tab = useAiChatStore.getState().tabs.find((t) => t.id === "t2")!;
    // Tool result appended as a user message
    const last = tab.messages[tab.messages.length - 1];
    expect(last.type).toBe("user");
    expect(last.message?.content?.[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu1",
    });
    expect(last.message?.content?.[0].content).toContain("main.tex");

    // Continuation request sent with empty prompt and full history
    expect(invoke).toHaveBeenCalledWith(
      "ai_execute",
      expect.objectContaining({
        request: expect.objectContaining({
          tabId: "t2",
          prompt: "",
          tools: expect.any(Array),
        }),
      }),
    );
    // Still streaming — the next provider turn is in flight
    expect(tab.isStreaming).toBe(true);
  });

  it("returns tool errors to the model instead of failing", async () => {
    setTabs([
      makeTab("t3", {
        isStreaming: true,
        messages: [
          userMsg("read it"),
          assistantToolUse("tu1", "read_file", { path: "missing.tex" }),
        ],
      }),
    ]);
    await useAiChatStore.getState()._handleTurnComplete("t3");

    const tab = useAiChatStore.getState().tabs.find((t) => t.id === "t3")!;
    const last = tab.messages[tab.messages.length - 1];
    expect(last.message?.content?.[0].is_error).toBe(true);
    expect(invoke).toHaveBeenCalled();
  });

  it("does nothing when the tab was cancelled", async () => {
    setTabs([
      makeTab("t4", {
        isStreaming: false,
        messages: [userMsg("hi"), assistantToolUse("tu1", "list_files")],
      }),
    ]);
    await useAiChatStore.getState()._handleTurnComplete("t4");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops with an error after the iteration limit", async () => {
    const tab = makeTab("t5", {
      isStreaming: true,
      messages: [userMsg("go"), assistantToolUse("tu0", "list_files")],
    });
    setTabs([tab]);

    // Each round: handle turn (executes tool + re-invokes), then simulate the
    // provider responding with another tool call.
    for (let i = 0; i < 9; i++) {
      await useAiChatStore.getState()._handleTurnComplete("t5");
      const t = useAiChatStore.getState().tabs.find((x) => x.id === "t5")!;
      if (!t.isStreaming) break;
      useAiChatStore
        .getState()
        ._appendMessage("t5", assistantToolUse(`tu${i + 1}`, "list_files"));
    }

    const final = useAiChatStore.getState().tabs.find((x) => x.id === "t5")!;
    expect(final.isStreaming).toBe(false);
    expect(final.error).toContain("limit");
  });
});

describe("toAiMessages duplicate hardening", () => {
  it("drops duplicated tool_use and tool_result blocks on replay", () => {
    const msgs: AiStreamMessage[] = [
      userMsg("go"),
      // Same tool call recorded twice (historic double-listener bug)
      assistantToolUse("tu1", "read_file", { path: "main.tex" }),
      assistantToolUse("tu1", "read_file", { path: "main.tex" }),
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu1", content: "x" },
            { type: "tool_result", tool_use_id: "tu1", content: "x" },
          ],
        },
      },
    ];
    const result = toAiMessages(msgs);
    const assistant = result.find((m) => m.role === "assistant")!;
    const toolUses = assistant.content!.filter(
      (b: any) => b.type === "tool_use",
    );
    expect(toolUses).toHaveLength(1);

    const user = result[result.length - 1];
    const toolResults = user.content!.filter(
      (b: any) => b.type === "tool_result",
    );
    expect(toolResults).toHaveLength(1);
  });

  it("does not execute a duplicated pending tool call twice", async () => {
    setTabs([
      makeTab("t6", {
        isStreaming: true,
        messages: [
          userMsg("go"),
          assistantToolUse("dup1", "list_files"),
          assistantToolUse("dup1", "list_files"),
        ],
      }),
    ]);
    await useAiChatStore.getState()._handleTurnComplete("t6");

    const tab = useAiChatStore.getState().tabs.find((t) => t.id === "t6")!;
    const last = tab.messages[tab.messages.length - 1];
    expect(last.type).toBe("user");
    expect(last.message?.content).toHaveLength(1);
  });
});

describe("toAiMessages interrupted tool-call recovery", () => {
  it("drops an unanswered tool call before the next user prompt", () => {
    const result = toAiMessages([
      userMsg("inspect the project"),
      assistantToolUse("interrupted", "list_files"),
      userMsg("continue without that"),
    ]);

    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "inspect the project" },
          { type: "text", text: "continue without that" },
        ],
      },
    ]);
  });

  it("keeps assistant text while removing its unanswered tool call", () => {
    const result = toAiMessages([
      userMsg("inspect the project"),
      assistantText("I will inspect the files."),
      assistantToolUse("interrupted", "list_files"),
      userMsg("skip that step"),
    ]);

    expect(result.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(result[1].content).toEqual([
      { type: "text", text: "I will inspect the files." },
    ]);
  });

  it("drops orphaned results and retains only fully paired parallel calls", () => {
    const result = toAiMessages([
      userMsg("inspect"),
      assistantToolUse("paired", "list_files"),
      assistantToolUse("missing", "read_file", { path: "main.tex" }),
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "paired",
              content: "main.tex",
            },
            {
              type: "tool_result",
              tool_use_id: "unknown",
              content: "stale",
            },
          ],
        },
      },
    ]);

    expect(result[1].content).toEqual([
      {
        type: "tool_use",
        id: "paired",
        name: "list_files",
        input: {},
      },
    ]);
    expect(result[2].content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "paired",
        content: "main.tex",
      },
    ]);
  });
});
