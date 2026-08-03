import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  usePendingApprovalsStore,
  APPROVAL_TIMEOUT_MS,
} from "@/stores/pending-approvals-store";
import { useDocumentStore } from "@/stores/document-store";
import { executeAiTool } from "@/lib/ai/tools";
import { AI_TOOL_DEFINITIONS } from "@/lib/ai/tools";

const store = () => usePendingApprovalsStore.getState();

function resetStore() {
  usePendingApprovalsStore.setState({
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
    if (cmd === "uv_add_packages") return "Installed 1 package" as any;
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
      .request({
        kind: "script",
        id: "s1",
        code: "print(1)",
        description: "d",
        createdAt: 0,
      })
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
      kind: "script",
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
      kind: "script",
      id: "s3",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    store().approve("s3");
    await first;

    // An agent loop retrying the same script must not need a second click
    const second = store().request({
      kind: "script",
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
      kind: "script",
      id: "s5",
      code: "print(1)",
      description: "d",
      createdAt: 0,
    });
    store().approve("s5");
    await first;

    store().request({
      kind: "script",
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
      kind: "script",
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
        kind: "script",
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
      kind: "script",
      id: "s9",
      code: "a",
      description: "d",
      createdAt: 0,
    });
    const b = store().request({
      kind: "script",
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

describe("install_python_packages", () => {
  it("is offered to the model", () => {
    expect(AI_TOOL_DEFINITIONS.map((t) => t.name)).toContain(
      "install_python_packages",
    );
  });

  it("always prompts, even when auto-approve is on", async () => {
    // A typosquatted package name reads as fine; unlike a script, the user
    // cannot judge it by reading, so the shortcut must not cover it.
    store().setAutoApprove(true);
    const call = executeAiTool(
      "install_python_packages",
      { packages: ["numpy"], reason: "For the maths" },
      "p1",
    );
    await Promise.resolve();
    expect(store().pending).toHaveLength(1);
    store().approve("p1");
    await call;
  });

  it("is not covered by a previously approved script", async () => {
    const first = store().request({
      kind: "script",
      id: "sx",
      code: "numpy",
      description: "d",
      createdAt: 0,
    });
    store().approve("sx");
    await first;

    const decision = store().request({
      kind: "packages",
      id: "px",
      packages: ["numpy"],
      reason: "r",
      createdAt: 0,
    });
    expect(store().pending.map((p) => p.id)).toEqual(["px"]);
    store().reject("px");
    expect(await decision).toBe("rejected");
  });

  it("installs nothing until approved", async () => {
    const call = executeAiTool(
      "install_python_packages",
      { packages: ["numpy"], reason: "For the maths" },
      "p2",
    );
    await Promise.resolve();
    expect(
      vi.mocked(invoke).mock.calls.some(([c]) => c === "uv_add_packages"),
    ).toBe(false);

    store().approve("p2");
    await call;
    expect(
      vi.mocked(invoke).mock.calls.some(([c]) => c === "uv_add_packages"),
    ).toBe(true);
  });

  it("refuses flags that would redirect the package index", async () => {
    for (const bad of [
      "--index-url=http://evil.example",
      "-i",
      "./local/pkg",
      "https://evil.example/p.tar.gz",
      "numpy; rm -rf ~",
    ]) {
      const result = await executeAiTool(
        "install_python_packages",
        { packages: [bad], reason: "r" },
        `bad-${bad}`,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/Refused/);
    }
    // Nothing may even reach the approval queue
    expect(store().pending).toHaveLength(0);
  });

  it("accepts ordinary requirement specifiers", async () => {
    const call = executeAiTool(
      "install_python_packages",
      { packages: ["numpy", "pandas>=2.0", "uvicorn[standard]"], reason: "r" },
      "p3",
    );
    await Promise.resolve();
    expect(store().pending).toHaveLength(1);
    store().approve("p3");
    const result = await call;
    expect(result.isError).toBeUndefined();
  });

  it("requires a reason", async () => {
    const result = await executeAiTool(
      "install_python_packages",
      { packages: ["numpy"] },
      "p4",
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/reason/);
  });
});
