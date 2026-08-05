import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAiChatStore, type TabState } from "@/stores/ai-chat-store";
import { useSkillsStore } from "@/stores/skills-store";
import { useDocumentStore } from "@/stores/document-store";
import { AI_TOOL_DEFINITIONS } from "@/lib/ai/tools";
import type { AiRequest } from "@/lib/ai/types";
import type { Skill } from "@/lib/skills/types";

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

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "proofread",
    title: "Proofread",
    description: "Fix grammar",
    body: "Proofread only. Change nothing else.",
    source: "builtin",
    warnings: [],
    ...overrides,
  };
}

/** The `ai_execute` payloads sent to Rust, in order. */
function executedRequests(): AiRequest[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "ai_execute")
    .map(([, args]) => (args as { request: AiRequest }).request);
}

const toolUse = (id: string, name: string) =>
  ({
    type: "assistant",
    message: {
      message: undefined,
      content: [{ type: "tool_use", id, name, input: {} }],
    },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);

  useDocumentStore.setState({
    projectRoot: "/project",
    files: [],
    activeFileId: null,
  } as any);

  useSkillsStore.setState({
    skills: [skill()],
    shadowed: [],
    errors: [],
    isLoading: false,
    loadedProjectRoot: null,
  });

  useAiChatStore.setState({
    messages: [],
    sessionId: null,
    isStreaming: false,
    error: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    activeSkillName: null,
    tabs: [makeTab("tab-1")],
    activeTabId: "tab-1",
    selectedModel: "claude-sonnet-5",
    _cancelledByUser: false,
  });
});

describe("setActiveSkill", () => {
  it("activates and clears a skill on the active tab", () => {
    useAiChatStore.getState().setActiveSkill("proofread");
    expect(useAiChatStore.getState().activeSkillName).toBe("proofread");
    expect(useAiChatStore.getState().tabs[0].activeSkillName).toBe("proofread");

    useAiChatStore.getState().setActiveSkill(null);
    expect(useAiChatStore.getState().activeSkillName).toBeNull();
  });

  it("keeps skills per tab", () => {
    useAiChatStore.setState({
      tabs: [makeTab("tab-1"), makeTab("tab-2")],
      activeTabId: "tab-1",
    });
    useAiChatStore.getState().setActiveSkill("proofread", "tab-2");

    const { tabs, activeSkillName } = useAiChatStore.getState();
    expect(tabs[1].activeSkillName).toBe("proofread");
    expect(tabs[0].activeSkillName).toBeNull();
    // The inactive tab's skill must not leak into the projected field
    expect(activeSkillName).toBeNull();
  });

  it("switches the model when the skill declares one", () => {
    useSkillsStore.setState({ skills: [skill({ model: "gpt-5.1" })] });
    useAiChatStore.getState().setActiveSkill("proofread");
    expect(useAiChatStore.getState().selectedModel).toBe("gpt-5.1");
  });

  it("leaves the model alone when the skill declares none", () => {
    useAiChatStore.getState().setActiveSkill("proofread");
    expect(useAiChatStore.getState().selectedModel).toBe("claude-sonnet-5");
  });
});

describe("sendPrompt with a skill", () => {
  it("sends no skillPrompt for plain chat", async () => {
    await useAiChatStore.getState().sendPrompt("hello");
    const [request] = executedRequests();
    expect(request.skillPrompt).toBeUndefined();
    expect(request.tools).toHaveLength(AI_TOOL_DEFINITIONS.length);
  });

  it("sends the skill body as skillPrompt, not systemPrompt", async () => {
    useAiChatStore.getState().setActiveSkill("proofread");
    await useAiChatStore.getState().sendPrompt("hello");

    const [request] = executedRequests();
    expect(request.skillPrompt).toBe("Proofread only. Change nothing else.");
    // Routing it through systemPrompt would drop the base LaTeX rules
    expect(request.systemPrompt).toBeUndefined();
  });

  it("narrows the tool set to the skill's allowlist", async () => {
    useSkillsStore.setState({
      skills: [skill({ tools: ["read_file", "search_project"] })],
    });
    useAiChatStore.getState().setActiveSkill("proofread");
    await useAiChatStore.getState().sendPrompt("hello");

    const [request] = executedRequests();
    expect(request.tools?.map((t) => t.name).sort()).toEqual([
      "read_file",
      "search_project",
    ]);
  });

  it("sends no tools at all for an empty allowlist", async () => {
    useSkillsStore.setState({ skills: [skill({ tools: [] })] });
    useAiChatStore.getState().setActiveSkill("proofread");
    await useAiChatStore.getState().sendPrompt("hello");

    expect(executedRequests()[0].tools).toEqual([]);
  });

  it("falls back to plain chat when the skill no longer exists", async () => {
    useAiChatStore.getState().setActiveSkill("proofread");
    // The user deleted the file after activating it
    useSkillsStore.setState({ skills: [] });
    await useAiChatStore.getState().sendPrompt("hello");

    const [request] = executedRequests();
    expect(request.skillPrompt).toBeUndefined();
    expect(request.tools).toHaveLength(AI_TOOL_DEFINITIONS.length);
  });
});

describe("tool-loop continuation", () => {
  it("carries the skill and its allowlist into the continuation request", async () => {
    useSkillsStore.setState({
      skills: [skill({ tools: ["read_file"] })],
    });
    useAiChatStore.setState({
      tabs: [
        makeTab("tab-1", {
          isStreaming: true,
          activeSkillName: "proofread",
          messages: [toolUse("tu1", "read_file")],
        }),
      ],
      activeTabId: "tab-1",
      isStreaming: true,
      activeSkillName: "proofread",
    });

    await useAiChatStore.getState()._handleTurnComplete("tab-1");

    const requests = executedRequests();
    expect(requests).toHaveLength(1);
    // A skill must not silently vanish part-way through an agent loop
    expect(requests[0].skillPrompt).toBe(
      "Proofread only. Change nothing else.",
    );
    expect(requests[0].tools?.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("blocks a tool call outside the skill's allowlist", async () => {
    useSkillsStore.setState({
      skills: [
        skill({ name: "explain", title: "Explain", tools: ["read_file"] }),
      ],
    });
    useAiChatStore.setState({
      tabs: [
        makeTab("tab-1", {
          isStreaming: true,
          activeSkillName: "explain",
          messages: [toolUse("tu1", "propose_edit")],
        }),
      ],
      activeTabId: "tab-1",
      isStreaming: true,
      activeSkillName: "explain",
    });

    await useAiChatStore.getState()._handleTurnComplete("tab-1");

    const messages = useAiChatStore.getState().tabs[0].messages;
    const result = messages[messages.length - 1].message?.content?.[0] as any;
    expect(result.type).toBe("tool_result");
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("not available");
    expect(result.content).toContain("Explain");
  });
});
