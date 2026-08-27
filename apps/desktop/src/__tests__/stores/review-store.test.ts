import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReviewComment, useReviewStore } from "@/stores/review-store";

const savedComment: ReviewComment = {
  id: "review-1",
  kind: "comment",
  documentRoot: "main.tex",
  author: "Dany",
  body: "Clarify this sentence.",
  status: "open",
  anchor: {
    kind: "text",
    page: 2,
    x: 42,
    y: 100,
    width: 120,
    height: 18,
    selectedText: "A selected sentence",
    source: {
      file: "chapters/introduction.tex",
      line: 18,
      column: 4,
    },
  },
  replies: [],
  createdAt: "2026-07-18T10:00:00.000Z",
  updatedAt: "2026-07-18T10:00:00.000Z",
};

function mockReviewDirectory(files: Record<string, unknown>) {
  vi.mocked(exists).mockImplementation(async (path) =>
    String(path).endsWith("/review"),
  );
  vi.mocked(readDir).mockResolvedValue(
    Object.keys(files).map((name) => ({
      name,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    })),
  );
  vi.mocked(readTextFile).mockImplementation(async (path) => {
    const name = String(path).split("/").pop() ?? "";
    const content = files[name];
    if (content === undefined) throw new Error(`unexpected read: ${path}`);
    return typeof content === "string" ? content : JSON.stringify(content);
  });
}

describe("useReviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewStore.setState({
      projectRoot: null,
      comments: [],
      loading: false,
      reviewer: "Reviewer",
      anchorChecks: new Map(),
    });
  });

  it("loads annotations from every reviewer file in review/", async () => {
    const peerComment: ReviewComment = {
      ...savedComment,
      id: "review-2",
      author: "Peer",
      kind: "highlight",
      body: "",
    };
    mockReviewDirectory({
      "dany.json": { version: 2, author: "Dany", annotations: [savedComment] },
      "peer.json": { version: 2, author: "Peer", annotations: [peerComment] },
      "notes.txt": "ignored",
    });
    vi.mocked(readDir).mockResolvedValue([
      { name: "dany.json", isFile: true, isDirectory: false, isSymlink: false },
      { name: "peer.json", isFile: true, isDirectory: false, isSymlink: false },
      { name: "notes.txt", isFile: true, isDirectory: false, isSymlink: false },
    ]);

    await useReviewStore.getState().loadProject("/project");

    expect(useReviewStore.getState().comments).toEqual([
      savedComment,
      peerComment,
    ]);
    expect(useReviewStore.getState().loading).toBe(false);
  });

  it("migrates a legacy v1 file into the review/ folder", async () => {
    const legacy = {
      id: savedComment.id,
      documentRoot: savedComment.documentRoot,
      body: savedComment.body,
      status: savedComment.status,
      anchor: savedComment.anchor,
      createdAt: savedComment.createdAt,
      updatedAt: savedComment.updatedAt,
    };
    vi.mocked(exists).mockImplementation(async (path) =>
      String(path).endsWith("review-comments.json"),
    );
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({ version: 1, comments: [legacy] }),
    );
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);

    await useReviewStore.getState().loadProject("/project");

    const migrated = useReviewStore.getState().comments;
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({
      id: "review-1",
      kind: "comment",
      author: "Reviewer",
      replies: [],
      body: "Clarify this sentence.",
    });
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith(
        "/project/review/reviewer.json",
        expect.stringContaining('"version": 2'),
      );
    });
  });

  it("treats missing or malformed files as an empty review", async () => {
    vi.mocked(exists).mockResolvedValue(false);
    await useReviewStore.getState().loadProject("/empty");
    expect(useReviewStore.getState().comments).toEqual([]);

    mockReviewDirectory({ "broken.json": "{not json" });
    await useReviewStore.getState().loadProject("/malformed");
    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it("persists annotations into the current reviewer's file", async () => {
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");
    useReviewStore.setState({ reviewer: "Dany Laksono" });

    const comment = useReviewStore.getState().addComment({
      documentRoot: "main.tex",
      body: "  Rework this paragraph.  ",
      anchor: savedComment.anchor,
    });
    expect(comment.body).toBe("Rework this paragraph.");
    expect(comment.author).toBe("Dany Laksono");
    expect(comment.kind).toBe("comment");

    useReviewStore.getState().setCommentStatus(comment.id, "resolved");
    expect(useReviewStore.getState().comments[0]?.status).toBe("resolved");

    useReviewStore.getState().deleteComment(comment.id);
    expect(useReviewStore.getState().comments).toEqual([]);

    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledTimes(3);
    });
    expect(mkdir).toHaveBeenCalledWith("/project/review", { recursive: true });
    expect(writeTextFile).toHaveBeenLastCalledWith(
      "/project/review/dany-laksono.json",
      JSON.stringify(
        { version: 2, author: "Dany Laksono", annotations: [] },
        null,
        2,
      ),
    );
  });

  it("stores highlights with an empty body", async () => {
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");

    const highlight = useReviewStore.getState().addComment({
      documentRoot: "main.tex",
      kind: "highlight",
      color: "green",
      body: "",
      anchor: savedComment.anchor,
    });
    expect(highlight.kind).toBe("highlight");
    expect(highlight.body).toBe("");
    expect(highlight.color).toBe("green");
  });

  it("appends replies to the parent annotation and persists its author's file", async () => {
    mockReviewDirectory({
      "dany.json": { version: 2, author: "Dany", annotations: [savedComment] },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");
    useReviewStore.setState({ reviewer: "Peer" });

    useReviewStore.getState().addReply("review-1", "  Agreed, will fix.  ");

    const [comment] = useReviewStore.getState().comments;
    expect(comment.replies).toHaveLength(1);
    expect(comment.replies[0]).toMatchObject({
      author: "Peer",
      body: "Agreed, will fix.",
    });

    await vi.waitFor(() => {
      // The parent comment belongs to Dany, so Dany's file is rewritten.
      expect(writeTextFile).toHaveBeenCalledWith(
        "/project/review/dany.json",
        expect.stringContaining("Agreed, will fix."),
      );
    });
  });
  it("normalises tags and drops them from the file when the last one goes", async () => {
    mockReviewDirectory({
      "dany.json": { version: 2, author: "Dany", annotations: [savedComment] },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");

    useReviewStore
      .getState()
      .setCommentTags("review-1", ["Likely Question", "#typo", "typo"]);
    expect(useReviewStore.getState().comments[0].tags).toEqual([
      "likely-question",
      "typo",
    ]);

    useReviewStore.getState().setCommentTags("review-1", []);
    // Absent rather than an empty array, so untagged annotations stay out of
    // everyone's diffs.
    expect(useReviewStore.getState().comments[0].tags).toBeUndefined();
  });

  it("does not rewrite a file when the tags did not actually change", async () => {
    mockReviewDirectory({
      "dany.json": {
        version: 2,
        author: "Dany",
        annotations: [{ ...savedComment, tags: ["typo"] }],
      },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");
    vi.mocked(writeTextFile).mockClear();

    useReviewStore.getState().setCommentTags("review-1", ["TYPO"]);

    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("keeps tags round-tripping through the review file", async () => {
    mockReviewDirectory({
      "dany.json": {
        version: 2,
        author: "Dany",
        annotations: [{ ...savedComment, tags: ["weakness"] }],
      },
    });
    await useReviewStore.getState().loadProject("/project");
    expect(useReviewStore.getState().comments[0].tags).toEqual(["weakness"]);
  });

  it("saves re-anchored positions but leaves unchanged annotations alone", async () => {
    mockReviewDirectory({
      "dany.json": { version: 2, author: "Dany", annotations: [savedComment] },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");
    vi.mocked(writeTextFile).mockClear();

    const moved = { ...savedComment.anchor, page: 5, y: 640 };
    useReviewStore
      .getState()
      .applyAnchorUpdates(
        [{ id: "review-1", anchor: moved, status: "moved" }],
        "fingerprint-b",
      );

    const [comment] = useReviewStore.getState().comments;
    expect(comment.anchor.page).toBe(5);
    // Following the text an annotation was always attached to is not a human
    // edit, so the timestamp stays put.
    expect(comment.updatedAt).toBe(savedComment.updatedAt);
    expect(useReviewStore.getState().anchorChecks.get("review-1")).toEqual({
      fingerprint: "fingerprint-b",
      status: "moved",
    });

    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith(
        "/project/review/dany.json",
        expect.stringContaining('"page": 5'),
      );
    });
  });

  it("records a check without writing when nothing moved", async () => {
    mockReviewDirectory({
      "dany.json": { version: 2, author: "Dany", annotations: [savedComment] },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");
    vi.mocked(writeTextFile).mockClear();

    useReviewStore
      .getState()
      .applyAnchorUpdates(
        [{ id: "review-1", anchor: savedComment.anchor, status: "drifted" }],
        "fingerprint-b",
      );

    expect(useReviewStore.getState().anchorChecks.get("review-1")?.status).toBe(
      "drifted",
    );
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("forgets the anchor check when the annotation is deleted", async () => {
    mockReviewDirectory({
      "dany.json": { version: 2, author: "Dany", annotations: [savedComment] },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await useReviewStore.getState().loadProject("/project");
    useReviewStore
      .getState()
      .applyAnchorUpdates(
        [{ id: "review-1", anchor: savedComment.anchor, status: "ok" }],
        "fingerprint-a",
      );

    useReviewStore.getState().deleteComment("review-1");

    expect(useReviewStore.getState().anchorChecks.has("review-1")).toBe(false);
  });
});
