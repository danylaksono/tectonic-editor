import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpIcon,
  SquareIcon,
  XIcon,
  FileTextIcon,
  FileCodeIcon,
  FileIcon,
  ImageIcon,
  FileSpreadsheetIcon,
  PaperclipIcon,
  CheckIcon,
  ChevronDownIcon,
  TargetIcon,
} from "lucide-react";
import type { AiContext } from "@/lib/ai/types";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { useAiChatStore, offsetToLineCol } from "@/stores/ai-chat-store";
import { useAiProviderStore } from "@/stores/ai-provider-store";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillsStore } from "@/stores/skills-store";
import { SkillPicker, matchSkillTrigger, rankSkills } from "./skill-picker";
import { getSkillIcon } from "./skill-icon";
import { getUniqueTargetName } from "@/lib/tauri/fs";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("chat-composer");

interface PinnedContext {
  label: string; // @file:line:col-line:col
  filePath: string;
  selectedText: string;
  imageDataUrl?: string; // thumbnail for captured images
}

function getFileIcon(file: ProjectFile) {
  if (file.type === "image")
    return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (file.type === "pdf")
    return (
      <FileSpreadsheetIcon className="size-3.5 shrink-0 text-muted-foreground" />
    );
  if (file.type === "style")
    return <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (file.type === "other")
    return <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  return <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

export const ChatComposer: FC<{ isOpen?: boolean }> = ({ isOpen }) => {
  const sendPrompt = useAiChatStore((s) => s.sendPrompt);
  const cancelExecution = useAiChatStore((s) => s.cancelExecution);
  const isStreaming = useAiChatStore((s) => s.isStreaming);
  const selectedModel = useAiChatStore((s) => s.selectedModel);
  const setSelectedModel = useAiChatStore((s) => s.setSelectedModel);
  const activeTabId = useAiChatStore((s) => s.activeTabId);
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const availableModels = useAiProviderStore((s) => s.availableModels);
  const loadModels = useAiProviderStore((s) => s.loadModels);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch the provider's model list (BYOK: from its API endpoint, with a
  // curated fallback)
  useEffect(() => {
    loadModels(aiProvider);
  }, [aiProvider, loadModels]);

  // Set default model when provider changes
  useEffect(() => {
    if (
      availableModels.length > 0 &&
      !availableModels.find((m) => m.id === selectedModel)
    ) {
      setSelectedModel(availableModels[0].id);
    }
  }, [aiProvider, availableModels, selectedModel, setSelectedModel]);

  // Model picker state
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const [pickerPos, setPickerPos] = useState<{ left: number; bottom: number }>({
    left: 0,
    bottom: 0,
  });

  // Context scope selector (for smart AI context)
  const [selectedScope, setSelectedScope] =
    useState<AiContext["scope"]>("selection");
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Anchor a popup directly above the button that opened it (clamped so it
  // can't overflow the right window edge)
  const anchorPickerTo = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPickerPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
      bottom: window.innerHeight - rect.top + 4,
    });
  }, []);

  // Pinned contexts — supports multiple files/selections
  const [pinnedContexts, setPinnedContexts] = useState<PinnedContext[]>([]);

  // File drop state
  const [isDragOver, setIsDragOver] = useState(false);

  // @ mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionFiles, setMentionFiles] = useState<ProjectFile[]>([]);
  const mentionRef = useRef<HTMLDivElement>(null);

  // `/` skill picker state
  const [skillQuery, setSkillQuery] = useState<string | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const skillListRef = useRef<HTMLDivElement>(null);
  const skills = useSkillsStore((s) => s.skills);
  const ensureSkillsLoaded = useSkillsStore((s) => s.ensureLoaded);
  const activeSkillName = useAiChatStore((s) => s.activeSkillName);
  const setActiveSkill = useAiChatStore((s) => s.setActiveSkill);
  const activeSkill = useMemo(
    () => skills.find((s) => s.name === activeSkillName),
    [skills, activeSkillName],
  );
  const matchedSkills = useMemo(
    () => (skillQuery === null ? [] : rankSkills(skillQuery, skills)),
    [skillQuery, skills],
  );

  // Keep refs to latest input/pinnedContexts so the tab-switch effect can
  // save the draft without depending on these values (which would cause loops).
  const inputRef = useRef(input);
  inputRef.current = input;
  const pinnedContextsRef = useRef(pinnedContexts);
  pinnedContextsRef.current = pinnedContexts;

  // Save draft to previous tab, restore draft from new tab
  const prevTabIdRef = useRef(activeTabId);
  useEffect(() => {
    const prevTabId = prevTabIdRef.current;
    if (prevTabId !== activeTabId) {
      // Save current input to the *previous* tab's draft (using refs for latest values)
      useAiChatStore.getState().saveDraft(prevTabId, {
        input: inputRef.current,
        pinnedContexts: pinnedContextsRef.current,
      });
    }
    prevTabIdRef.current = activeTabId;

    // Restore draft from the new active tab
    const tab = useAiChatStore
      .getState()
      .tabs.find((t) => t.id === activeTabId);
    const draft = tab?.draft;
    setInput(draft?.input ?? "");
    setPinnedContexts(draft?.pinnedContexts ?? []);
    setMentionQuery(null);
    setSkillQuery(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [activeTabId]);
  const composerRef = useRef<HTMLDivElement>(null);

  // Watch selection changes to auto-pin context
  const selectionRange = useDocumentStore((s) => s.selectionRange);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);
  const importFiles = useDocumentStore((s) => s.importFiles);
  const refreshFiles = useDocumentStore((s) => s.refreshFiles);
  const projectRoot = useDocumentStore((s) => s.projectRoot);

  // Load built-in + user + project skills; reloads when the project changes
  useEffect(() => {
    void ensureSkillsLoaded(projectRoot);
  }, [projectRoot, ensureSkillsLoaded]);

  // Consume pending attachments from external sources (e.g. PDF capture)
  const pendingAttachments = useAiChatStore((s) => s.pendingAttachments);
  const consumePendingAttachments = useAiChatStore(
    (s) => s.consumePendingAttachments,
  );

  // Focus textarea when the drawer opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
    prevOpenRef.current = !!isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (pendingAttachments.length === 0) return;
    const attachments = consumePendingAttachments();
    if (attachments.length === 0) return;
    setPinnedContexts((prev) => {
      const existingLabels = new Set(prev.map((c) => c.label));
      const unique = attachments.filter((a) => !existingLabels.has(a.label));
      return [...prev, ...unique];
    });
    // Focus textarea so user can type immediately
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [pendingAttachments, consumePendingAttachments]);

  const currentContextLabel = useMemo(() => {
    if (!selectionRange) return null;
    const file = files.find((f) => f.id === activeFileId);
    if (!file?.content) return null;
    const start = offsetToLineCol(file.content, selectionRange.start);
    const end = offsetToLineCol(file.content, selectionRange.end);
    return `@${file.relativePath}:${start.line}:${start.col}-${end.line}:${end.col}`;
  }, [selectionRange, activeFileId, files]);

  // Auto-pin when a new selection is made
  useEffect(() => {
    if (!selectionRange || !currentContextLabel) return;
    const file = files.find((f) => f.id === activeFileId);
    if (!file?.content) return;
    // Replace any existing selection-based context (keep file contexts)
    setPinnedContexts((prev) => {
      const filtered = prev.filter(
        (c) => !c.label.includes(":") || c.label.startsWith("@attachments/"),
      );
      return [
        ...filtered,
        {
          label: currentContextLabel,
          filePath: file.relativePath,
          selectedText: file.content!.slice(
            selectionRange.start,
            selectionRange.end,
          ),
        },
      ];
    });
  }, [selectionRange, currentContextLabel, activeFileId, files]);

  // Compute @ mention matches
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionFiles([]);
      return;
    }
    const q = mentionQuery.toLowerCase();
    const matched = files
      .filter(
        (f) =>
          f.relativePath.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q),
      )
      .slice(0, 8);
    setMentionFiles(matched);
    setMentionIndex(0);
  }, [mentionQuery, files]);

  const selectMention = useCallback(
    (file: ProjectFile) => {
      // Replace @query with empty and pin the file as context
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursorPos = textarea.selectionStart;
      // Find the @ position before cursor
      const textBefore = input.slice(0, cursorPos);
      const atIndex = textBefore.lastIndexOf("@");
      if (atIndex === -1) return;
      const newInput = input.slice(0, atIndex) + input.slice(cursorPos);
      setInput(newInput);
      setMentionQuery(null);

      // Pin the whole file as context
      const isTextFile =
        file.type === "tex" ||
        file.type === "bib" ||
        file.type === "style" ||
        file.type === "other";
      setPinnedContexts((prev) => [
        ...prev,
        {
          label: `@${file.relativePath}`,
          filePath: file.relativePath,
          selectedText: isTextFile
            ? (file.content ?? "")
            : `[Referenced file: ${file.relativePath} (${file.type} file)]`,
        },
      ]);

      // Refocus textarea
      setTimeout(() => textarea.focus(), 0);
    },
    [input],
  );

  // Activating a skill consumes the whole `/query` — it is never sent as text
  const selectSkill = useCallback(
    (skill: { name: string }) => {
      setActiveSkill(skill.name);
      setInput("");
      setSkillQuery(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [setActiveSkill],
  );

  const openSkillGallery = useCallback(() => {
    setSkillQuery(null);
    window.dispatchEvent(new CustomEvent("open-skill-gallery"));
  }, []);

  // Handle file drops — guard against duplicate calls from stale HMR listeners
  const isProcessingDropRef = useRef(false);
  const handleFileDropRef = useRef<(paths: string[]) => Promise<void>>(
    async () => {},
  );
  handleFileDropRef.current = async (paths: string[]) => {
    if (!projectRoot || paths.length === 0) return;
    if (isProcessingDropRef.current) return;
    isProcessingDropRef.current = true;

    try {
      // Import files to attachments/ folder — returns actual (deduplicated) relative paths
      const importedPaths = await importFiles(paths, "attachments");

      // Pin each file as context
      const storeFiles = useDocumentStore.getState().files;
      const newContexts: PinnedContext[] = [];

      for (const relativePath of importedPaths) {
        const imported = storeFiles.find(
          (f) => f.relativePath === relativePath,
        );

        if (imported) {
          const isText =
            imported.type === "tex" ||
            imported.type === "bib" ||
            imported.type === "style" ||
            imported.type === "other";
          newContexts.push({
            label: `@${relativePath}`,
            filePath: relativePath,
            selectedText: isText
              ? (imported.content ?? "")
              : `[Attached file: ${relativePath} (${imported.type} file)]`,
          });
        } else {
          // File imported but type might be filtered out — still pin as reference
          newContexts.push({
            label: `@${relativePath}`,
            filePath: relativePath,
            selectedText: `[Attached file: ${relativePath}]`,
          });
        }
      }

      if (newContexts.length > 0) {
        setPinnedContexts((prev) => {
          // Deduplicate by label
          const existingLabels = new Set(prev.map((c) => c.label));
          const unique = newContexts.filter(
            (c) => !existingLabels.has(c.label),
          );
          return [...prev, ...unique];
        });
      }
    } finally {
      isProcessingDropRef.current = false;
    }
  };

  // Listen for Tauri drag-drop events (OS file drops)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (cancelled) return;
        const { type } = event.payload;
        if (type === "enter") {
          setIsDragOver(true);
        } else if (type === "drop") {
          setIsDragOver(false);
          // Skip if the sidebar already handled this drop (OS file dropped on sidebar file tree)
          if ((window as any).__sidebarHandledDrop) {
            log.debug("skipped — sidebar handled this drop");
            return;
          }
          const paths = (event.payload as { paths: string[] }).paths;
          if (paths?.length > 0) {
            await handleFileDropRef.current?.(paths);
          }
        } else if (type === "leave") {
          setIsDragOver(false);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Not in Tauri environment (dev mode), ignore
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Handle clipboard paste — detect files (screenshots, images) and save to attachments/
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardFiles = e.clipboardData?.files;
      if (!clipboardFiles || clipboardFiles.length === 0 || !projectRoot)
        return;

      // Check if there are actual file items (not just text)
      const fileItems = Array.from(clipboardFiles);
      if (fileItems.length === 0) return;

      e.preventDefault();

      const newContexts: PinnedContext[] = [];

      for (const file of fileItems) {
        // Generate a filename — use the original name or a timestamp-based name for screenshots
        let fileName = file.name;
        if (!fileName || fileName === "image.png") {
          const ext = file.type.split("/")[1] || "png";
          fileName = `paste-${Date.now()}.${ext}`;
        }

        const targetName = `attachments/${fileName}`;

        try {
          // Ensure attachments/ directory exists
          const attachmentsDir = await join(projectRoot, "attachments");
          if (!(await exists(attachmentsDir))) {
            await mkdir(attachmentsDir, { recursive: true });
          }

          // Deduplicate filename
          const uniqueName = await getUniqueTargetName(projectRoot, targetName);
          const fullPath = await join(projectRoot, uniqueName);

          // Read file data and write to disk
          const buffer = await file.arrayBuffer();
          await writeFile(fullPath, new Uint8Array(buffer));

          // Determine if it's a text file
          const isText = file.type.startsWith("text/");
          const content = isText
            ? await file.text()
            : `[Attached file: ${uniqueName} (${file.type})]`;

          newContexts.push({
            label: `@${uniqueName}`,
            filePath: uniqueName,
            selectedText: content,
          });
        } catch (err) {
          log.error("Failed to save pasted file", {
            fileName,
            error: String(err),
          });
        }
      }

      if (newContexts.length > 0) {
        // Refresh file list so the store knows about new files
        await refreshFiles();

        setPinnedContexts((prev) => {
          const existingLabels = new Set(prev.map((c) => c.label));
          const unique = newContexts.filter(
            (c) => !existingLabels.has(c.label),
          );
          return [...prev, ...unique];
        });
      }
    },
    [projectRoot, refreshFiles],
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const finalPrompt = trimmed;

    setInput("");
    setMentionQuery(null);

    const ctx: AiContext = {
      scope: selectedScope,
      files:
        pinnedContexts.length > 0 ? pinnedContexts.map((c) => c.filePath) : [],
      // Vestigial: skills replaced the Action picker, and Rust never read this
      // field. Kept constant because the Rust `AiContext.action` is required.
      action: "chat",
      selection:
        pinnedContexts.length > 0
          ? pinnedContexts.map((c) => c.selectedText).join("\n\n---\n\n")
          : undefined,
    };

    // Send with pinned context override
    if (pinnedContexts.length > 0) {
      const combinedLabel = pinnedContexts.map((c) => c.label).join(", ");
      const combinedText = pinnedContexts
        .map((c) => c.selectedText)
        .join("\n\n---\n\n");
      sendPrompt(
        finalPrompt,
        {
          label: combinedLabel,
          filePath: pinnedContexts[0].filePath,
          selectedText: combinedText,
        },
        ctx,
      );
    } else {
      sendPrompt(finalPrompt, undefined, ctx);
    }
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // Clear pinned contexts after send
    setPinnedContexts([]);
  }, [input, isStreaming, sendPrompt, pinnedContexts]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // `/` skill picker navigation
      if (skillQuery !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          setSkillQuery(null);
          return;
        }
        if (matchedSkills.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSkillIndex((i) => Math.min(i + 1, matchedSkills.length - 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSkillIndex((i) => Math.max(i - 1, 0));
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            selectSkill(matchedSkills[skillIndex]);
            return;
          }
        }
      }

      // @ mention navigation
      if (mentionQuery !== null && mentionFiles.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => Math.min(i + 1, mentionFiles.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectMention(mentionFiles[mentionIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Backspace at start of empty input removes last pinned context
      if (e.key === "Backspace" && pinnedContexts.length > 0 && input === "") {
        e.preventDefault();
        setPinnedContexts((prev) => prev.slice(0, -1));
      }
    },
    [
      handleSend,
      pinnedContexts,
      input,
      mentionQuery,
      mentionFiles,
      mentionIndex,
      selectMention,
      skillQuery,
      matchedSkills,
      skillIndex,
      selectSkill,
    ],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);

      // Detect @ mention trigger
      const cursorPos = e.target.selectionStart;
      const textBefore = value.slice(0, cursorPos);
      // Match @ at start of input or after a space
      const atMatch = textBefore.match(/(?:^|[\s])@([^\s]*)$/);
      if (atMatch) {
        setMentionQuery(atMatch[1]);
      } else {
        setMentionQuery(null);
      }

      const slashQuery = matchSkillTrigger(value);
      setSkillQuery(slashQuery);
      if (slashQuery !== null) setSkillIndex(0);

      // Auto-resize
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    },
    [],
  );

  // Scroll active mention into view
  useEffect(() => {
    if (mentionRef.current) {
      const active = mentionRef.current.querySelector("[data-active=true]");
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex]);

  // Scroll active skill into view
  useEffect(() => {
    const active = skillListRef.current?.querySelector("[data-active=true]");
    active?.scrollIntoView({ block: "nearest" });
  }, [skillIndex]);

  // Close model picker on click outside
  useEffect(() => {
    if (!modelPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        modelPickerRef.current &&
        !modelPickerRef.current.contains(target) &&
        modelButtonRef.current &&
        !modelButtonRef.current.contains(target)
      ) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelPickerOpen]);

  return (
    <div ref={composerRef} className="relative shrink-0 p-3">
      {/* Model picker popup — portal to body to escape all stacking contexts */}
      {modelPickerOpen &&
        createPortal(
          <div
            ref={modelPickerRef}
            className="fixed w-64 rounded-lg border border-border bg-background shadow-lg"
            style={{
              left: pickerPos.left,
              bottom: pickerPos.bottom,
              zIndex: 9999,
            }}
          >
            {/* Models */}
            <div className="p-1">
              <div className="px-2 py-1 font-medium text-muted-foreground text-xs">
                Model
              </div>
              {availableModels.length > 8 && (
                <input
                  type="text"
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder="Filter models..."
                  className="mb-1 w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                />
              )}
              <div className="max-h-64 overflow-y-auto">
                {availableModels
                  .filter(
                    (m) =>
                      !modelFilter ||
                      m.id.toLowerCase().includes(modelFilter.toLowerCase()) ||
                      m.name.toLowerCase().includes(modelFilter.toLowerCase()),
                  )
                  .map((m) => (
                    <button
                      key={m.id}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                        selectedModel === m.id
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted",
                      )}
                      onClick={() => setSelectedModel(m.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-xs">
                          {m.name}
                        </div>
                        {m.desc && (
                          <div className="truncate text-muted-foreground text-xs">
                            {m.desc}
                          </div>
                        )}
                      </div>
                      {selectedModel === m.id && (
                        <CheckIcon className="size-3 shrink-0" />
                      )}
                    </button>
                  ))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Scope picker dropdown */}
      {scopePickerOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50"
            onClick={() => setScopePickerOpen(false)}
          >
            <div
              className="absolute min-w-[140px] overflow-hidden rounded-lg border border-border bg-background shadow-lg"
              style={{ left: pickerPos.left, bottom: pickerPos.bottom }}
            >
              <div className="p-1">
                {(
                  [
                    {
                      id: "selection",
                      label: "Selection",
                      desc: "Selected text only",
                    },
                    { id: "file", label: "File", desc: "Current file" },
                    {
                      id: "chapter",
                      label: "Chapter",
                      desc: "Current section",
                    },
                    { id: "preamble", label: "Preamble", desc: "Setup only" },
                    {
                      id: "bibliography",
                      label: "Bibliography",
                      desc: "References",
                    },
                    { id: "project", label: "Project", desc: "Full project" },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    onClick={() => {
                      setSelectedScope(s.id);
                      setScopePickerOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-xs">{s.label}</div>
                      <div className="truncate text-muted-foreground text-xs">
                        {s.desc}
                      </div>
                    </div>
                    {selectedScope === s.id && (
                      <CheckIcon className="size-3 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* `/` skill picker */}
      {skillQuery !== null && (
        <SkillPicker
          skills={matchedSkills}
          activeIndex={skillIndex}
          onSelect={selectSkill}
          onHover={setSkillIndex}
          onBrowseAll={openSkillGallery}
          listRef={skillListRef}
        />
      )}

      {/* @ mention dropdown */}
      {mentionQuery !== null && mentionFiles.length > 0 && (
        <div
          ref={mentionRef}
          className="absolute right-3 bottom-full left-3 mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
        >
          {mentionFiles.map((file, i) => {
            const parts = file.relativePath.split("/");
            const fileName = parts.pop()!;
            const dirPath = parts.length > 0 ? `${parts.join("/")}/` : "";
            return (
              <button
                key={file.id}
                data-active={i === mentionIndex}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  i === mentionIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                )}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur
                  selectMention(file);
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                {getFileIcon(file)}
                <span className="truncate font-mono text-sm">{fileName}</span>
                {dirPath && (
                  <span className="ml-auto shrink-0 font-mono text-muted-foreground text-xs">
                    {dirPath}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        className={cn(
          "flex w-full flex-col rounded-2xl border border-input bg-muted/30 transition-colors focus-within:border-ring focus-within:bg-background",
          isDragOver && "border-ring bg-accent/20",
        )}
      >
        {/* Pinned context chips */}
        {pinnedContexts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-0">
            {pinnedContexts.map((ctx, i) =>
              ctx.imageDataUrl ? (
                <div
                  key={`${ctx.label}-${i}`}
                  className="group relative overflow-hidden rounded-lg border border-border bg-muted"
                >
                  <img
                    src={ctx.imageDataUrl}
                    alt={ctx.label}
                    className="block h-16 w-auto object-contain"
                  />
                  <button
                    aria-label="Remove attachment"
                    onClick={() =>
                      setPinnedContexts((prev) =>
                        prev.filter((_, idx) => idx !== i),
                      )
                    }
                    className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ) : (
                <span
                  key={`${ctx.label}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground text-xs"
                >
                  {ctx.label}
                  <button
                    aria-label="Remove context"
                    onClick={() =>
                      setPinnedContexts((prev) =>
                        prev.filter((_, idx) => idx !== i),
                      )
                    }
                    className="ml-0.5 rounded-sm p-0.5 transition-colors hover:bg-muted-foreground/20"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ),
            )}
          </div>
        )}

        {isDragOver ? (
          <div className="flex min-h-10 items-center justify-center px-4 py-3 text-muted-foreground text-sm">
            <PaperclipIcon className="mr-2 size-4" />
            Drop files to attach
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask me anything (@ to mention files)"
            className="max-h-40 min-h-10 w-full resize-none bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted-foreground"
            rows={1}
          />
        )}

        <div className="flex items-center justify-between px-2 pb-2">
          {/* Model, scope, and action selectors */}
          <div className="flex items-center gap-0.5">
            {/* Scope selector */}
            <button
              type="button"
              onClick={(e) => {
                anchorPickerTo(e.currentTarget);
                setScopePickerOpen((v) => !v);
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
              title={`Scope: ${selectedScope}`}
            >
              <TargetIcon className="size-3" />
              <span className="capitalize">{selectedScope}</span>
              <ChevronDownIcon className="size-2.5" />
            </button>

            {/* Model & settings selector */}
            <button
              ref={modelButtonRef}
              type="button"
              onClick={(e) => {
                anchorPickerTo(e.currentTarget);
                setModelFilter("");
                setModelPickerOpen((v) => !v);
              }}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
            >
              <span>
                {availableModels.find((m) => m.id === selectedModel)?.name ??
                  selectedModel}
              </span>
              <ChevronDownIcon className="size-3" />
            </button>

            {/* Active skill — sticky for this tab until cleared */}
            {activeSkillName &&
              (() => {
                const SkillIcon = getSkillIcon(activeSkill?.icon);
                const missing = !activeSkill;
                return (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                      missing
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-violet-500/15 text-violet-600 dark:text-violet-400",
                    )}
                    title={
                      missing
                        ? `Skill "${activeSkillName}" is no longer available — messages are sent as plain chat`
                        : activeSkill.description
                    }
                  >
                    <SkillIcon className="size-3 shrink-0" />
                    {activeSkill?.title ?? activeSkillName}
                    {missing && " (missing)"}
                    <button
                      type="button"
                      aria-label="Clear skill"
                      className="ml-0.5 rounded-sm p-0.5 transition-colors hover:bg-foreground/10"
                      onClick={() => setActiveSkill(null)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                );
              })()}
          </div>

          {isStreaming ? (
            <TooltipIconButton
              tooltip="Stop"
              side="top"
              variant="secondary"
              size="icon"
              className="size-8 rounded-full"
              onClick={cancelExecution}
            >
              <SquareIcon className="size-3 fill-current" />
            </TooltipIconButton>
          ) : (
            <TooltipIconButton
              tooltip="Send"
              side="top"
              variant="default"
              size="icon"
              className="size-8 rounded-full"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <ArrowUpIcon className="size-4" />
            </TooltipIconButton>
          )}
        </div>
      </div>
    </div>
  );
};
