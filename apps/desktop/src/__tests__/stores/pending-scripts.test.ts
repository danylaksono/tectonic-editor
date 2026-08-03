import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  usePendingScriptsStore,
  APPROVAL_TIMEOUT_MS,
} from "@/stores/pending-scripts-store";
import { useDocumentStore } from "@/stores/document-store";
import { executeAiTool } from "@/lib/ai/tools";
import { AI_TOOL_DEFINITIONS } from "@/lib/ai/tools";

const store = () => usePendingScriptsStore.getState();

function resetStore() {
  usePendingScriptsStore.setState({
    pending: [],
    approvedCode: [],
    autoApprove: false,
  });
}

const RESULT = {
  stdout: "42\n",
  stderr: "",
  exit_code: 0,
  timed_out: false,
  cancelled: false,
  truncated: false,
  script_path: "/project/.tectonic-editor/scripts/abc.py",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  useDocumentStore.setState({ projectRoot: "/project" } as any);
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "uv_run_python") return RESULT as any;
    return undefined as any;
  });
});

afterEach(() => {
  store().rejectAll();
});

describe("approval gate", () => {
  it("holds the call until the user approves", async () => {
    const settled = vi.fn();
    const request = store()
      .request({ id: "s1", code: "print(1)", description: "d", createdAt: 0 })
      .then(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(store().pending).toHaveLength(1);

    store().approve("s1");
    await request;
    expect(settled).toHaveBeenCalledWith("approved");
    expect(store().pending).toHaveLength(0);
  });

  it("reports rejection", async () => {
    const request = store().request({
      id: "s2",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    store().reject("s2");
    expect(await request).toBe("rejected");
  });

  it("does not re-prompt for byte-identical code already approved", async () => {
    const first = store().request({
      id: "s3",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    store().approve("s3");
    await first;

    // An agent loop retrying the same script must not need a second click
    const second = store().request({
      id: "s4",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    expect(await second).toBe("approved");
    expect(store().pending).toHaveLength(0);
  });

  it("re-prompts once the code changes", async () => {
    const first = store().request({
      id: "s5",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    store().approve("s5");
    await first;

    store().request({
      id: "s6",
      code: "print(2)",
      description: "d",
      createdAt: 0,
    });
    expect(store().pending.map((p) => p.id)).toEqual(["s6"]);
  });

  it("skips the prompt when auto-approve is on", async () => {
    store().setAutoApprove(true);
    const decision = await store().request({
      id: "s7",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    expect(decision).toBe("approved");
    expect(store().pending).toHaveLength(0);
  });

  it("times out rather than waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const request = store().request({
        id: "s8",
        code: "print(1)",
        description: "d",
        createdAt: 0,
      });
      vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS + 1);
      expect(await request).toBe("timeout");
      expect(store().pending).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejectAll settles everything waiting", async () => {
    const a = store().request({
      id: "s9",
      code: "a",
      description: "d",
      createdAt: 0,
    });
    const b = store().request({
      id: "s10",
      code: "b",
      description: "d",
      createdAt: 0,
    });
    store().rejectAll();
    expect(await a).toBe("rejected");
    expect(await b).toBe("rejected");
  });
});

describe("run_python tool", () => {
  it("is offered to the model", () => {
    expect(AI_TOOL_DEFINITIONS.map((t) => t.name)).toContain("run_python");
  });

  it("does not execute anything until approved", async () => {
    const call = executeAiTool(
      "run_python",
      { code: "print(1)", description: "Print one" },
      "t1",
    );
    await Promise.resolve();
    await Promise.resolve();

    const ran = vi
      .mocked(invoke)
      .mock.calls.some(([cmd]) => cmd === "uv_run_python");
    expect(ran).toBe(false);

    store().approve("t1");
    const result = await call;
    expect(result.content).toContain("42");
  });

  it("runs in the project venv once approved, creating it on demand", async () => {
    const call = executeAiTool(
      "run_python",
      { code: "print(1)", description: "Print one" },
      "t2",
    );
    await Promise.resolve();
    store().approve("t2");
    await call;

    const commands = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(commands).toContain("setup_project_venv");
    expect(commands).toContain("uv_run_python");
  });

  it("tells the model plainly when the user declines", async () => {
    const call = executeAiTool(
      "run_python",
      { code: "print(1)", description: "Print one" },
      "t3",
    );
    await Promise.resolve();
    store().reject("t3");

    const result = await call;
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/declined/i);
    expect(
      vi.mocked(invoke).mock.calls.some(([c]) => c === "uv_run_python"),
    ).toBe(false);
  });

  it("requires a description, since the user reads it when deciding", async () => {
    const result = await executeAiTool(
      "run_python",
      { code: "print(1)" },
      "t4",
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/description/);
    expect(store().pending).toHaveLength(0);
  });

  it("surfaces a timed-out script as an error with its partial output", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "uv_run_python") {
        return { ...RESULT, timed_out: true, stdout: "partial" } as any;
      }
      return undefined as any;
    });

    const call = executeAiTool(
      "run_python",
      { code: "while True: pass", description: "Loop" },
      "t5",
    );
    await Promise.resolve();
    store().approve("t5");

    const result = await call;
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/time limit/i);
    expect(result.content).toContain("partial");
  });
});
