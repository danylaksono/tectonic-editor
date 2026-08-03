import { useRef, useState, useCallback, useEffect } from "react";
import {
  ChevronDownIcon,
  LibraryIcon,
  Maximize2Icon,
  MessageCircleIcon,
  Minimize2Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useDocumentStore } from "@/stores/document-store";
import { useAiEvents } from "@/hooks/use-ai-events";
import { ChatMessages } from "./chat-messages";
import { ChatComposer } from "./chat-composer";
import { ChatTabBar } from "./chat-tab-bar";
import { SkillGallery } from "./skill-gallery";

const MIN_HEIGHT = 150;
const DEFAULT_HEIGHT = 360;

export function AiChatDrawer() {
  // Initialize event listeners for AI streaming (provider-agnostic)
  useAiEvents();

  const anyStreaming = useAiChatStore((s) => s.tabs.some((t) => t.isStreaming));
  const error = useAiChatStore((s) => s.error);

  // The gallery is opened from here, from the composer's "Browse all skills…"
  // row, and from the activity rail — all via one window event.
  const [skillGalleryOpen, setSkillGalleryOpen] = useState(false);
  useEffect(() => {
    const handler = () => setSkillGalleryOpen(true);
    window.addEventListener("open-skill-gallery", handler);
    return () => window.removeEventListener("open-skill-gallery", handler);
  }, []);

  // Reset the chat session when the project changes so stale messages from a
  // previous project don't leak into the next one. (The chat store is global
  // and outlives this component's per-project remount.)
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  useEffect(() => {
    useAiChatStore.getState().newSession();
  }, [projectRoot]);

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasDraggedRef = useRef(false);
  const heightRef = useRef(height);
  heightRef.current = height;

  const pendingAttachments = useAiChatStore((s) => s.pendingAttachments);

  // Auto-open when streaming starts or a new attachment is added
  useEffect(() => {
    const shouldOpen = anyStreaming || pendingAttachments.length > 0;
    if (shouldOpen && !isOpen) {
      setIsOpen(true);
      const parent = containerRef.current?.parentElement;
      const maxHeight = parent ? parent.clientHeight * 0.5 : 400;
      setHeight(maxHeight);
      heightRef.current = maxHeight;
      if (panelRef.current) {
        panelRef.current.style.height = `${maxHeight}px`;
      }
    }
  }, [anyStreaming, isOpen, pendingAttachments]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isExpanded) return;

      e.preventDefault();
      setIsDragging(true);
      hasDraggedRef.current = false;

      const startY = e.clientY;
      const startHeight = heightRef.current;

      const handleMouseMove = (e: MouseEvent) => {
        hasDraggedRef.current = true;
        const parent = containerRef.current?.parentElement;
        const maxHeight = parent ? parent.clientHeight * 0.5 : 400;
        const delta = startY - e.clientY;
        const newHeight = Math.min(
          Math.max(startHeight + delta, MIN_HEIGHT),
          maxHeight,
        );
        heightRef.current = newHeight;
        if (panelRef.current) {
          panelRef.current.style.height = `${newHeight}px`;
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        setHeight(heightRef.current);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isExpanded],
  );

  // Compute expanded dimensions from parent
  const getExpandedDimensions = useCallback(() => {
    const parent = containerRef.current?.parentElement;
    return {
      height: parent?.clientHeight ?? 600,
      width: parent?.clientWidth ?? 800,
    };
  }, []);

  const panelStyle = (): React.CSSProperties => {
    if (!isOpen && !isExpanded) {
      return { height: 0, maxWidth: 672, borderRadius: 24 };
    }
    if (isExpanded) {
      const dims = getExpandedDimensions();
      return { height: dims.height, maxWidth: dims.width, borderRadius: 0 };
    }
    return { height, maxWidth: 672, borderRadius: 24 };
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex items-end justify-center transition-[padding] duration-300 ease-out",
        isExpanded ? "p-0" : "px-4 pt-4 pb-6",
      )}
    >
      {/* Floating toggle button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          // bottom-14 keeps the FAB clear of the PDF-preview toggle that sits
          // in the same corner of the editor panel (right-3 bottom-3)
          "pointer-events-auto absolute right-3 bottom-14 flex size-12 items-center justify-center rounded-full border border-border bg-background shadow-lg transition-all duration-300 ease-out hover:scale-105 hover:shadow-xl",
          isOpen
            ? "pointer-events-none scale-50 opacity-0"
            : "scale-100 opacity-100",
        )}
        aria-label="Open AI Assistant"
      >
        <MessageCircleIcon className="size-5 text-foreground" />
      </button>

      {/* Chat panel */}
      <div
        ref={panelRef}
        className={cn(
          "pointer-events-auto flex w-full flex-col overflow-hidden border bg-background transition-[height,max-width,border-radius,border-color,box-shadow,opacity,transform] duration-300 ease-out",
          isExpanded
            ? "border-transparent shadow-none"
            : "border-border shadow-2xl",
          isOpen
            ? "scale-100 opacity-100"
            : "pointer-events-none origin-bottom scale-95 opacity-0",
          isDragging && "!transition-none",
        )}
        style={panelStyle()}
      >
        {/* Header with drag handle, tab bar, and session selector */}
        {isExpanded ? (
          <>
            <div className="flex items-center justify-start border-border border-b px-2 py-1">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Exit fullscreen"
              >
                <Minimize2Icon className="size-4" />
              </button>
            </div>
            <ChatTabBar />
          </>
        ) : (
          <>
            <div className="relative">
              <div
                className="group flex cursor-row-resize items-center justify-center gap-2 py-2 transition-colors hover:bg-muted/50"
                onMouseDown={handleMouseDown}
                onClick={() => {
                  if (!hasDraggedRef.current) {
                    setIsOpen(false);
                  }
                }}
              >
                <div className="h-1 w-10 rounded-full bg-muted-foreground/30 transition-all group-hover:w-8" />
                <ChevronDownIcon className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="absolute top-1/2 left-2 flex -translate-y-1/2 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsExpanded(true)}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Fullscreen"
                >
                  <Maximize2Icon className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSkillGalleryOpen(true)}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Skills"
                  title="Skills"
                >
                  <LibraryIcon className="size-4" />
                </button>
              </div>
            </div>
            <ChatTabBar />
          </>
        )}

        {/* Error banner */}
        {error && (
          <div className="mx-3 mb-1 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-destructive text-xs">
            {error}
          </div>
        )}

        {/* Messages area */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ChatMessages />
        </div>

        {/* Composer */}
        <ChatComposer isOpen={isOpen} />
      </div>

      <SkillGallery
        open={skillGalleryOpen}
        onOpenChange={setSkillGalleryOpen}
      />
    </div>
  );
}
