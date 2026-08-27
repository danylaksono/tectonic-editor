import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createLogger } from "@/lib/debug/logger";
import { useSettingsStore } from "@/stores/settings-store";
import { dedupeReviewTags } from "@/lib/review-tags";
import type { ReviewDrawingTool, ReviewPoint } from "@/lib/review-drawing";

const log = createLogger("review");
const REVIEW_FILE_VERSION = 2;
const REVIEW_DIRECTORY = "review";

export interface ReviewSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface ReviewAnchor {
  kind: "text" | "point";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  selectedText?: string;
  source?: ReviewSourceLocation;
}

export interface ReviewReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export type ReviewAnnotationKind = "comment" | "highlight" | "drawing";

/** A mark drawn over the page: a scribble, or a shape swept out in one drag.
 *  Points are page-relative PDF coordinates, the same space as `anchor`. */
export interface ReviewDrawing {
  tool: ReviewDrawingTool;
  /** Freehand carries the whole stroke; the shapes carry the drag's two ends. */
  points: ReviewPoint[];
  /** PDF points. Absent means the default width. */
  strokeWidth?: number;
}

/** How one annotation's anchor fared against a freshly compiled PDF.
 *
 *  "ok" — its text is still under it; "shifted" — its text turned up elsewhere,
 *  so the annotation now points at the wrong place and we know where the text
 *  went; "drifted" — its text is gone, so the position is suspect and we cannot
 *  say where it should be; "unverified" — there was nothing to search by, which
 *  is not evidence either way.
 *
 *  None of these move the annotation. Where it sits is a deliberate act by
 *  whoever placed it, and this is a report on that placement, not a correction
 *  to it. */
export type ReviewAnchorStatus = "ok" | "shifted" | "drifted" | "unverified";

/** Where an annotation's text was found, in unscaled PDF page coordinates. */
export interface ReviewFoundLocation {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewAnchorUpdate {
  id: string;
  status: ReviewAnchorStatus;
  /** Set only for "shifted": where the text is now, so the UI can offer to
   *  show it without changing what is stored. */
  foundAt?: ReviewFoundLocation;
}

/** A request from elsewhere in the app — the editor gutter — to reveal one
 *  annotation in the PDF. The counter lets the same annotation be requested
 *  twice in a row, mirroring the preview store's location request. */
export interface ReviewSelectionRequest {
  id: string;
  requestId: number;
}

export interface ReviewAnchorCheck {
  /** Fingerprint of the PDF this annotation was last checked against. */
  fingerprint: string;
  status: ReviewAnchorStatus;
  /** Where the annotation's text turned up, when it turned up elsewhere. */
  foundAt?: ReviewFoundLocation;
}

export interface ReviewComment {
  id: string;
  kind: ReviewAnnotationKind;
  documentRoot: string;
  author: string;
  body: string;
  status: "open" | "resolved";
  anchor: ReviewAnchor;
  /** Highlight colour token (see REVIEW_HIGHLIGHT_COLORS); absent for
   *  comments and for highlights saved before colours existed. */
  color?: string;
  /** Free-form labels, normalised (see lib/review-tags). Absent, not empty,
   *  when untagged — keeps untagged annotations out of everyone's diffs. */
  tags?: string[];
  /** Set only when kind is "drawing". */
  drawing?: ReviewDrawing;
  replies: ReviewReply[];
  createdAt: string;
  updatedAt: string;
}

/** One reviewer's file inside the project's review/ folder. Keeping each
 *  reviewer in their own file means peer round-trips merge without conflicts:
 *  everyone only rewrites files for authors whose annotations they touched. */
interface ReviewFile {
  version: number;
  author: string;
  annotations: ReviewComment[];
}

/** Legacy v1 file at .tectonic-editor/review-comments.json. */
interface LegacyReviewFile {
  version: number;
  comments: unknown[];
}

interface AddReviewCommentInput {
  documentRoot: string;
  body: string;
  anchor: ReviewAnchor;
  kind?: ReviewAnnotationKind;
  color?: string;
  tags?: string[];
  drawing?: ReviewDrawing;
}

interface ReviewState {
  projectRoot: string | null;
  comments: ReviewComment[];
  loading: boolean;
  /** Resolved author name used for new annotations and replies. */
  reviewer: string;
  /** Which PDF version each anchor was last verified against, and how that
   *  went. Deliberately in memory only: persisting it would rewrite every
   *  review file on every recompile, and it costs one pass per PDF to redo. */
  anchorChecks: Map<string, ReviewAnchorCheck>;
  selectionRequest: ReviewSelectionRequest | null;
  loadProject: (projectRoot: string) => Promise<void>;
  clearProject: () => void;
  addComment: (input: AddReviewCommentInput) => ReviewComment;
  addReply: (id: string, body: string) => void;
  setCommentStatus: (id: string, status: ReviewComment["status"]) => void;
  setCommentTags: (id: string, tags: string[]) => void;
  /** Ask the preview to select and scroll to one annotation. */
  requestSelection: (id: string) => void;
  /** Record the outcome of an anchor check. Nothing is written to disk: the
   *  check is a report, and the annotations themselves are unchanged. */
  applyAnchorUpdates: (
    updates: ReviewAnchorUpdate[],
    fingerprint: string,
  ) => void;
  deleteComment: (id: string) => void;
}

let writeQueue: Promise<void> = Promise.resolve();

const FALLBACK_REVIEWER = "Reviewer";
let cachedDefaultReviewer: string | null = null;

/** Reviewer identity: explicit Settings value, else git user.name / OS
 *  username (resolved once per session by the backend), else "Reviewer". */
async function resolveReviewerName(): Promise<string> {
  const configured = useSettingsStore.getState().reviewerName.trim();
  if (configured) return configured;
  if (cachedDefaultReviewer === null) {
    try {
      cachedDefaultReviewer = (
        await invoke<string>("get_default_reviewer_name")
      ).trim();
    } catch {
      cachedDefaultReviewer = "";
    }
  }
  return cachedDefaultReviewer || FALLBACK_REVIEWER;
}

function isReviewSourceLocation(value: unknown): value is ReviewSourceLocation {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<ReviewSourceLocation>;
  return (
    typeof source.file === "string" &&
    typeof source.line === "number" &&
    typeof source.column === "number"
  );
}

function isReviewAnchor(value: unknown): value is ReviewAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Partial<ReviewAnchor>;
  return (
    (anchor.kind === "text" || anchor.kind === "point") &&
    typeof anchor.page === "number" &&
    typeof anchor.x === "number" &&
    typeof anchor.y === "number" &&
    typeof anchor.width === "number" &&
    typeof anchor.height === "number" &&
    (anchor.source === undefined || isReviewSourceLocation(anchor.source))
  );
}

function isReviewReply(value: unknown): value is ReviewReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<ReviewReply>;
  return (
    typeof reply.id === "string" &&
    typeof reply.author === "string" &&
    typeof reply.body === "string" &&
    typeof reply.createdAt === "string"
  );
}

const DRAWING_TOOLS: ReviewDrawingTool[] = [
  "freehand",
  "line",
  "arrow",
  "box",
  "ellipse",
];

function isReviewPoint(value: unknown): value is ReviewPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<ReviewPoint>;
  return typeof point.x === "number" && typeof point.y === "number";
}

function isReviewDrawing(value: unknown): value is ReviewDrawing {
  if (!value || typeof value !== "object") return false;
  const drawing = value as Partial<ReviewDrawing>;
  return (
    DRAWING_TOOLS.includes(drawing.tool as ReviewDrawingTool) &&
    Array.isArray(drawing.points) &&
    drawing.points.length > 0 &&
    drawing.points.every(isReviewPoint) &&
    (drawing.strokeWidth === undefined ||
      typeof drawing.strokeWidth === "number")
  );
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (!value || typeof value !== "object") return false;
  const comment = value as Partial<ReviewComment>;
  // A drawing with no stroke would be an annotation nobody can see or click.
  if (comment.kind === "drawing" && !isReviewDrawing(comment.drawing)) {
    return false;
  }
  return (
    typeof comment.id === "string" &&
    (comment.kind === "comment" ||
      comment.kind === "highlight" ||
      comment.kind === "drawing") &&
    typeof comment.documentRoot === "string" &&
    typeof comment.author === "string" &&
    typeof comment.body === "string" &&
    (comment.status === "open" || comment.status === "resolved") &&
    (comment.color === undefined || typeof comment.color === "string") &&
    (comment.tags === undefined ||
      (Array.isArray(comment.tags) &&
        comment.tags.every((tag) => typeof tag === "string"))) &&
    typeof comment.createdAt === "string" &&
    typeof comment.updatedAt === "string" &&
    Array.isArray(comment.replies) &&
    comment.replies.every(isReviewReply) &&
    isReviewAnchor(comment.anchor)
  );
}

function parseReviewFile(value: string): ReviewComment[] {
  try {
    const parsed = JSON.parse(value) as Partial<ReviewFile>;
    if (
      parsed.version !== REVIEW_FILE_VERSION ||
      !Array.isArray(parsed.annotations)
    ) {
      return [];
    }
    return parsed.annotations.filter(isReviewComment);
  } catch {
    return [];
  }
}

/** Upgrade v1 comments (no kind/author/replies) to the v2 shape. */
function parseLegacyReviewFile(value: string, author: string): ReviewComment[] {
  try {
    const parsed = JSON.parse(value) as Partial<LegacyReviewFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.comments)) return [];
    return parsed.comments
      .map((entry): unknown => ({
        kind: "comment",
        author,
        replies: [],
        ...(entry as object),
      }))
      .filter(isReviewComment);
  } catch {
    return [];
  }
}

async function reviewDirectoryPath(projectRoot: string): Promise<string> {
  return join(projectRoot, REVIEW_DIRECTORY);
}

async function legacyReviewFilePath(projectRoot: string): Promise<string> {
  return join(projectRoot, ".tectonic-editor", "review-comments.json");
}

/** File name for one reviewer's annotations, e.g. review/dany-laksono.json. */
function reviewerFileName(author: string): string {
  const slug = author
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "reviewer"}.json`;
}

async function loadReviewDirectory(
  projectRoot: string,
): Promise<ReviewComment[]> {
  const directory = await reviewDirectoryPath(projectRoot);
  if (!(await exists(directory))) return [];
  const entries = await readDir(directory);
  const comments: ReviewComment[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    try {
      const content = await readTextFile(await join(directory, entry.name));
      comments.push(...parseReviewFile(content));
    } catch (error) {
      log.error("Failed to read review file", {
        file: entry.name,
        error: String(error),
      });
    }
  }
  return comments;
}

/** Rewrite the review files of the given authors from the current state.
 *  Serialized through a queue so rapid edits never interleave writes. */
function persistAuthors(
  projectRoot: string,
  comments: ReviewComment[],
  authors: Iterable<string>,
): void {
  const authorSet = new Set(authors);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const directory = await reviewDirectoryPath(projectRoot);
      await mkdir(directory, { recursive: true });
      for (const author of authorSet) {
        const snapshot: ReviewFile = {
          version: REVIEW_FILE_VERSION,
          author,
          annotations: comments.filter((comment) => comment.author === author),
        };
        await writeTextFile(
          await join(directory, reviewerFileName(author)),
          JSON.stringify(snapshot, null, 2),
        );
      }
    })
    .catch((error) => {
      log.error("Failed to save review annotations", {
        error: String(error),
      });
    });
}

function createCommentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}`;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  projectRoot: null,
  comments: [],
  loading: false,
  reviewer: FALLBACK_REVIEWER,
  anchorChecks: new Map(),
  selectionRequest: null,

  loadProject: async (projectRoot) => {
    set({ projectRoot, comments: [], loading: true, anchorChecks: new Map() });
    try {
      const reviewer = await resolveReviewerName();
      let comments = await loadReviewDirectory(projectRoot);

      // One-time migration: projects saved before the review/ folder existed
      // kept a single hidden file under .tectonic-editor.
      if (comments.length === 0) {
        const legacyPath = await legacyReviewFilePath(projectRoot);
        if (await exists(legacyPath)) {
          const migrated = parseLegacyReviewFile(
            await readTextFile(legacyPath),
            reviewer,
          );
          if (migrated.length > 0) {
            comments = migrated;
            persistAuthors(projectRoot, comments, [reviewer]);
            log.info("Migrated legacy review comments", {
              count: migrated.length,
            });
          }
        }
      }

      if (get().projectRoot === projectRoot) {
        set({ comments, loading: false, reviewer, anchorChecks: new Map() });
      }
    } catch (error) {
      log.error("Failed to load review annotations", {
        error: String(error),
      });
      if (get().projectRoot === projectRoot) {
        set({ comments: [], loading: false });
      }
    }
  },

  clearProject: () =>
    set({
      projectRoot: null,
      comments: [],
      loading: false,
      anchorChecks: new Map(),
      selectionRequest: null,
    }),

  addComment: (input) => {
    const now = new Date().toISOString();
    const comment: ReviewComment = {
      id: createCommentId(),
      kind: input.kind ?? "comment",
      documentRoot: input.documentRoot,
      author: get().reviewer,
      body: input.body.trim(),
      status: "open",
      anchor: input.anchor,
      color: input.color,
      tags: input.tags?.length ? dedupeReviewTags(input.tags) : undefined,
      drawing: input.drawing,
      replies: [],
      createdAt: now,
      updatedAt: now,
    };
    const comments = [...get().comments, comment];
    set({ comments });
    const projectRoot = get().projectRoot;
    if (projectRoot) persistAuthors(projectRoot, comments, [comment.author]);
    return comment;
  },

  addReply: (id, body) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const reply: ReviewReply = {
      id: createCommentId(),
      author: get().reviewer,
      body: trimmed,
      createdAt: new Date().toISOString(),
    };
    let touchedAuthor: string | null = null;
    const comments = get().comments.map((comment) => {
      if (comment.id !== id) return comment;
      touchedAuthor = comment.author;
      return {
        ...comment,
        replies: [...comment.replies, reply],
        updatedAt: reply.createdAt,
      };
    });
    if (!touchedAuthor) return;
    set({ comments });
    const projectRoot = get().projectRoot;
    // Replies live on the parent annotation, so the parent author's file is
    // the one that changes.
    if (projectRoot) persistAuthors(projectRoot, comments, [touchedAuthor]);
  },

  setCommentStatus: (id, status) => {
    let touchedAuthor: string | null = null;
    const comments = get().comments.map((comment) => {
      if (comment.id !== id) return comment;
      touchedAuthor = comment.author;
      return { ...comment, status, updatedAt: new Date().toISOString() };
    });
    if (!touchedAuthor) return;
    set({ comments });
    const projectRoot = get().projectRoot;
    if (projectRoot) persistAuthors(projectRoot, comments, [touchedAuthor]);
  },

  setCommentTags: (id, tags) => {
    const normalized = dedupeReviewTags(tags);
    let touchedAuthor: string | null = null;
    const comments = get().comments.map((comment) => {
      if (comment.id !== id) return comment;
      const current = comment.tags ?? [];
      if (
        current.length === normalized.length &&
        current.every((tag, index) => tag === normalized[index])
      ) {
        return comment;
      }
      touchedAuthor = comment.author;
      return {
        ...comment,
        tags: normalized.length ? normalized : undefined,
        updatedAt: new Date().toISOString(),
      };
    });
    if (!touchedAuthor) return;
    set({ comments });
    const projectRoot = get().projectRoot;
    if (projectRoot) persistAuthors(projectRoot, comments, [touchedAuthor]);
  },

  requestSelection: (id) =>
    set((state) => ({
      selectionRequest: {
        id,
        requestId: (state.selectionRequest?.requestId ?? 0) + 1,
      },
    })),

  applyAnchorUpdates: (updates, fingerprint) => {
    if (updates.length === 0) return;
    const anchorChecks = new Map(get().anchorChecks);
    for (const update of updates) {
      anchorChecks.set(update.id, {
        fingerprint,
        status: update.status,
        foundAt: update.foundAt,
      });
    }
    set({ anchorChecks });
  },

  deleteComment: (id) => {
    const target = get().comments.find((comment) => comment.id === id);
    if (!target) return;
    const comments = get().comments.filter((comment) => comment.id !== id);
    const anchorChecks = new Map(get().anchorChecks);
    anchorChecks.delete(id);
    set({ comments, anchorChecks });
    const projectRoot = get().projectRoot;
    if (projectRoot) persistAuthors(projectRoot, comments, [target.author]);
  },
}));
