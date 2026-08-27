import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  CircleIcon,
  CornerDownRightIcon,
  FileTextIcon,
  HighlighterIcon,
  LoaderIcon,
  MessageSquareIcon,
  ReplyIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type {
  ReviewAnchor,
  ReviewAnchorCheck,
  ReviewComment,
} from "@/stores/review-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { resolveReviewHighlightColor } from "@/lib/review-colors";
import {
  collectReviewTags,
  dedupeReviewTags,
  MAX_REVIEW_TAGS,
  parseReviewTags,
  SUGGESTED_REVIEW_TAGS,
} from "@/lib/review-tags";

interface ReviewCommentsPanelProps {
  comments: ReviewComment[];
  loading: boolean;
  selectedId: string | null;
  /** Outcome of the last re-anchor pass, keyed by annotation id. */
  anchorChecks: Map<string, ReviewAnchorCheck>;
  onSelect: (comment: ReviewComment) => void;
  onGoToSource: (comment: ReviewComment) => void;
  onSetStatus: (
    comment: ReviewComment,
    status: ReviewComment["status"],
  ) => void;
  onSetTags: (comment: ReviewComment, tags: string[]) => void;
  onReply: (comment: ReviewComment, body: string) => void;
  onDelete: (comment: ReviewComment) => void;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** One tag, either as a filter toggle in the header or a removable chip on a
 *  card. Deliberately monochrome — highlight colour already carries meaning
 *  here, and a second colour axis would fight it. */
function TagChip({
  tag,
  count,
  active,
  onClick,
  onRemove,
}: {
  tag: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const content = (
    <>
      <span className="truncate">{tag}</span>
      {count !== undefined && (
        <span className="text-muted-foreground tabular-nums">{count}</span>
      )}
    </>
  );
  const className = cn(
    "inline-flex max-w-40 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight transition-colors",
    active
      ? "border-primary/60 bg-primary/10 text-foreground"
      : "border-border bg-muted/50 text-muted-foreground",
    onClick && "hover:border-foreground/30 hover:text-foreground",
  );

  if (onRemove) {
    return (
      <span className={className}>
        {content}
        <button
          type="button"
          className="-mr-0.5 rounded-full p-0.5 text-muted-foreground hover:text-destructive"
          aria-label={`Remove tag ${tag}`}
          onClick={onRemove}
        >
          <XIcon className="size-2.5" />
        </button>
      </span>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        aria-pressed={active}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return <span className={className}>{content}</span>;
}

function TagEditor({
  tags,
  knownTags,
  onChange,
  onClose,
}: {
  tags: string[];
  knownTags: string[];
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = useRef(
    `review-tags-${Math.random().toString(36).slice(2, 8)}`,
  ).current;

  const commit = (value: string) => {
    const added = parseReviewTags(value);
    if (added.length === 0) return;
    onChange(dedupeReviewTags([...tags, ...added]));
    setDraft("");
  };

  // Anything already on this annotation is not worth suggesting again.
  const suggestions = [...new Set([...knownTags, ...SUGGESTED_REVIEW_TAGS])]
    .filter((tag) => !tags.includes(tag))
    .slice(0, 12);

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
      <datalist id={listId}>
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <input
        value={draft}
        list={listId}
        placeholder={
          tags.length >= MAX_REVIEW_TAGS ? "Tag limit reached" : "Add a tag…"
        }
        disabled={tags.length >= MAX_REVIEW_TAGS}
        className="h-7 w-full rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary/60"
        // biome-ignore lint/a11y/noAutofocus: the editor only opens on request
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit(draft);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft("");
            onClose();
          } else if (event.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
      />
      {suggestions.length > 0 && tags.length < MAX_REVIEW_TAGS && (
        <div className="flex flex-wrap gap-1">
          {suggestions.slice(0, 5).map((tag) => (
            <button
              key={tag}
              type="button"
              className="rounded-full border border-border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              onClick={() => onChange(dedupeReviewTags([...tags, tag]))}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReviewCommentsPanel({
  comments,
  loading,
  selectedId,
  anchorChecks,
  onSelect,
  onGoToSource,
  onSetStatus,
  onSetTags,
  onReply,
  onDelete,
}: ReviewCommentsPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [driftedOnly, setDriftedOnly] = useState(false);

  const tagCounts = useMemo(() => collectReviewTags(comments), [comments]);
  const knownTags = useMemo(
    () => tagCounts.map((entry) => entry.tag),
    [tagCounts],
  );

  const driftedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const comment of comments) {
      if (anchorChecks.get(comment.id)?.status === "drifted") {
        ids.add(comment.id);
      }
    }
    return ids;
  }, [comments, anchorChecks]);

  // A filter for a tag nobody uses any more would silently empty the list.
  useEffect(() => {
    setActiveTags((current) => {
      const kept = current.filter((tag) => knownTags.includes(tag));
      return kept.length === current.length ? current : kept;
    });
  }, [knownTags]);
  useEffect(() => {
    if (driftedOnly && driftedIds.size === 0) setDriftedOnly(false);
  }, [driftedOnly, driftedIds]);

  const visibleComments = useMemo(
    () =>
      comments
        .filter((comment) => showResolved || comment.status === "open")
        .filter(
          (comment) =>
            activeTags.length === 0 ||
            (comment.tags ?? []).some((tag) => activeTags.includes(tag)),
        )
        .filter((comment) => !driftedOnly || driftedIds.has(comment.id))
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "open" ? -1 : 1;
          return a.anchor.page - b.anchor.page;
        }),
    [comments, showResolved, activeTags, driftedOnly, driftedIds],
  );
  const openCount = comments.filter(
    (comment) => comment.status === "open",
  ).length;

  const toggleTag = (tag: string) =>
    setActiveTags((current) =>
      current.includes(tag)
        ? current.filter((entry) => entry !== tag)
        : [...current, tag],
    );

  return (
    <aside
      className="flex h-full w-80 shrink-0 flex-col border-border border-l bg-background"
      aria-label="Review comments"
    >
      <div className="flex h-[calc(44px+var(--titlebar-height))] shrink-0 items-end justify-between border-border border-b px-3 pb-2">
        <div>
          <h2 className="font-medium text-sm">Review</h2>
          <p className="text-muted-foreground text-xs">
            {openCount} open · {comments.length} total
          </p>
        </div>
        <Button
          variant={showResolved ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setShowResolved((value) => !value)}
        >
          {showResolved ? "Hide resolved" : "Show resolved"}
        </Button>
      </div>

      {(tagCounts.length > 0 || driftedIds.size > 0) && (
        <div className="flex flex-wrap gap-1 border-border border-b px-3 py-2">
          {driftedIds.size > 0 && (
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight transition-colors",
                driftedOnly
                  ? "border-amber-500/70 bg-amber-500/15 text-foreground"
                  : "border-amber-500/40 text-amber-600 hover:bg-amber-500/10",
              )}
              aria-pressed={driftedOnly}
              title="Annotations that could not be located in the current PDF"
              onClick={() => setDriftedOnly((value) => !value)}
            >
              <TriangleAlertIcon className="size-3" />
              {driftedIds.size} drifted
            </button>
          )}
          {tagCounts.map(({ tag, count }) => (
            <TagChip
              key={tag}
              tag={tag}
              count={count}
              active={activeTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            />
          ))}
          {(activeTags.length > 0 || driftedOnly) && (
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setActiveTags([]);
                setDriftedOnly(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <LoaderIcon className="size-4 animate-spin" />
            Loading comments…
          </div>
        ) : visibleComments.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <MessageSquareIcon className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="font-medium text-sm">
              {comments.length === 0
                ? "No annotations yet"
                : activeTags.length > 0 || driftedOnly
                  ? "Nothing matches this filter"
                  : "No open annotations"}
            </p>
            <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
              Pick the highlighter or comment tool in the toolbar, then drag a
              box or click on the PDF.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleComments.map((comment) => {
              const drifted = driftedIds.has(comment.id);
              const tags = comment.tags ?? [];
              return (
                <article
                  key={comment.id}
                  className={cn(
                    "rounded-lg border bg-card p-3 transition-colors",
                    selectedId === comment.id
                      ? "border-primary/60 ring-2 ring-primary/15"
                      : "hover:border-foreground/20",
                    comment.status === "resolved" && "opacity-65",
                  )}
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onSelect(comment)}
                  >
                    <div className="mb-2 flex items-center gap-2 text-muted-foreground text-xs">
                      {comment.status === "resolved" ? (
                        <CheckCircle2Icon className="size-3.5 text-emerald-600" />
                      ) : comment.kind === "highlight" ? (
                        <HighlighterIcon
                          className={cn(
                            "size-3.5",
                            resolveReviewHighlightColor(comment.color).accent,
                          )}
                        />
                      ) : (
                        <CircleIcon className="size-3.5" />
                      )}
                      <span className="max-w-24 truncate font-medium text-foreground">
                        {comment.author}
                      </span>
                      <span>p. {comment.anchor.page}</span>
                      {drifted && (
                        <TriangleAlertIcon
                          className="size-3.5 shrink-0 text-amber-600"
                          aria-label="Position may be out of date"
                        />
                      )}
                      <span className="ml-auto shrink-0">
                        {formatTimestamp(comment.createdAt)}
                      </span>
                    </div>
                    {comment.anchor.selectedText && (
                      <blockquote
                        className={cn(
                          "mb-2 line-clamp-3 border-l-2 pl-2 text-muted-foreground text-xs",
                          comment.kind === "highlight"
                            ? resolveReviewHighlightColor(comment.color).border
                            : "border-muted-foreground/30",
                        )}
                      >
                        {comment.anchor.selectedText}
                      </blockquote>
                    )}
                    {comment.body ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {comment.body}
                      </p>
                    ) : comment.kind === "highlight" ? (
                      <p className="text-muted-foreground text-xs italic">
                        Highlight
                      </p>
                    ) : null}
                  </button>

                  {drifted && (
                    <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 leading-relaxed dark:text-amber-400">
                      Could not be found in the current PDF — it is still shown
                      where it last was, which may no longer be the right place.
                    </p>
                  )}

                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <TagChip
                          key={tag}
                          tag={tag}
                          onRemove={() =>
                            onSetTags(
                              comment,
                              tags.filter((entry) => entry !== tag),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}

                  {editingTagsFor === comment.id && (
                    <TagEditor
                      tags={tags}
                      knownTags={knownTags}
                      onChange={(next) => onSetTags(comment, next)}
                      onClose={() => setEditingTagsFor(null)}
                    />
                  )}

                  {comment.replies.length > 0 && (
                    <div className="mt-2 space-y-2 border-border border-l-2 pl-2">
                      {comment.replies.map((reply) => (
                        <div key={reply.id} className="text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                            <CornerDownRightIcon className="size-3" />
                            <span className="max-w-32 truncate font-medium text-foreground">
                              {reply.author}
                            </span>
                            <span className="ml-auto shrink-0">
                              {formatTimestamp(reply.createdAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap pl-4 leading-relaxed">
                            {reply.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {replyingTo === comment.id && (
                    <ReplyComposer
                      onSubmit={(body) => {
                        onReply(comment, body);
                        setReplyingTo(null);
                      }}
                      onCancel={() => setReplyingTo(null)}
                    />
                  )}

                  <div className="mt-3 flex items-center gap-1 border-border border-t pt-2">
                    {comment.anchor.source && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onGoToSource(comment)}
                      >
                        <FileTextIcon className="size-3.5" />
                        Source
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() =>
                        setReplyingTo((current) =>
                          current === comment.id ? null : comment.id,
                        )
                      }
                    >
                      <ReplyIcon className="size-3.5" />
                      Reply
                    </Button>
                    <Button
                      variant={
                        editingTagsFor === comment.id ? "secondary" : "ghost"
                      }
                      size="icon"
                      className="size-7"
                      aria-label="Edit tags"
                      title="Tags"
                      onClick={() =>
                        setEditingTagsFor((current) =>
                          current === comment.id ? null : comment.id,
                        )
                      }
                    >
                      <TagIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        onSetStatus(
                          comment,
                          comment.status === "open" ? "resolved" : "open",
                        )
                      }
                    >
                      {comment.status === "open" ? "Resolve" : "Reopen"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                      aria-label="Delete annotation"
                      onClick={() => onDelete(comment)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function ReplyComposer({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const submit = () => {
    if (body.trim()) {
      onSubmit(body.trim());
      setBody("");
    }
  };
  return (
    <div className="mt-2 space-y-1.5">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Reply…"
        className="min-h-16 resize-y text-sm"
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            onCancel();
          }
        }}
      />
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!body.trim()}
          onClick={submit}
        >
          Reply
        </Button>
      </div>
    </div>
  );
}

export interface ReviewCommentDraft {
  anchor: ReviewAnchor;
  documentRoot: string;
}

interface ReviewCommentDialogProps {
  draft: ReviewCommentDraft | null;
  /** Tags already in use in this project, offered as suggestions. */
  knownTags: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (body: string, tags: string[]) => void;
}

export function ReviewCommentDialog({
  draft,
  knownTags,
  onOpenChange,
  onSave,
}: ReviewCommentDialogProps) {
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (draft) {
      setBody("");
      setTags([]);
    }
  }, [draft]);

  const suggestions = [...new Set([...knownTags, ...SUGGESTED_REVIEW_TAGS])]
    .filter((tag) => !tags.includes(tag))
    .slice(0, 6);

  return (
    <Dialog open={!!draft} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add review comment</DialogTitle>
        </DialogHeader>
        {draft?.anchor.selectedText && (
          <blockquote className="max-h-28 overflow-y-auto border-muted-foreground/30 border-l-2 pl-3 text-muted-foreground text-sm">
            {draft.anchor.selectedText}
          </blockquote>
        )}
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What should be changed or checked?"
          className="min-h-28 resize-y"
          autoFocus
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              body.trim()
            ) {
              event.preventDefault();
              onSave(body.trim(), tags);
            }
          }}
        />
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                onRemove={() =>
                  setTags((current) => current.filter((entry) => entry !== tag))
                }
              />
            ))}
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                className="rounded-full border border-border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                onClick={() =>
                  setTags((current) => dedupeReviewTags([...current, tag]))
                }
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!body.trim()}
            onClick={() => onSave(body.trim(), tags)}
          >
            Add comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
