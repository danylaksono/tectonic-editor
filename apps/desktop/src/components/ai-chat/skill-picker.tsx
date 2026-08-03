import type { FC, RefObject } from "react";
import { LibraryIcon } from "lucide-react";
import type { Skill } from "@/lib/skills/types";
import { fuzzyRank } from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";
import { getSkillIcon } from "./skill-icon";

/**
 * Decide whether the composer's current text opens the skill picker, and with
 * what query. `/` counts only at the very start of an otherwise-unbroken token:
 * LaTeX prose is full of slashes, so a `/` anywhere else stays literal text.
 * Returns the query (possibly empty, for a bare `/`) or null for no trigger.
 */
export function matchSkillTrigger(value: string): string | null {
  const match = value.match(/^\/([^\s]*)$/);
  return match ? match[1] : null;
}

/** Rank skills for a `/` query: name and title fuzzily, description by substring. */
export function rankSkills(query: string, skills: Skill[]): Skill[] {
  return fuzzyRank(query, skills, (s) => ({
    primary: s.name,
    secondary: s.title,
    description: s.description,
  }));
}

interface SkillPickerProps {
  skills: Skill[];
  activeIndex: number;
  onSelect: (skill: Skill) => void;
  onHover: (index: number) => void;
  onBrowseAll: () => void;
  listRef: RefObject<HTMLDivElement | null>;
}

/**
 * The `/` dropdown above the composer. Presentational: the composer owns the
 * query, the selection index, and all keyboard handling.
 */
export const SkillPicker: FC<SkillPickerProps> = ({
  skills,
  activeIndex,
  onSelect,
  onHover,
  onBrowseAll,
  listRef,
}) => {
  return (
    <div
      ref={listRef}
      className="absolute right-3 bottom-full left-3 mb-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      <div className="max-h-56 overflow-y-auto">
        {skills.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground text-sm">
            No matching skills
          </div>
        ) : (
          skills.map((skill, i) => {
            const Icon = getSkillIcon(skill.icon);
            return (
              <button
                key={`${skill.source}:${skill.name}`}
                type="button"
                data-active={i === activeIndex}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors",
                  i === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                )}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the textarea
                  onSelect(skill);
                }}
                onMouseEnter={() => onHover(i)}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-sm">
                      {skill.title}
                    </span>
                    <span className="truncate font-mono text-muted-foreground text-xs">
                      /{skill.name}
                    </span>
                    {skill.source !== "builtin" && (
                      <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground uppercase">
                        {skill.source}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {skill.description}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-2 border-border border-t px-3 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
        onMouseDown={(e) => {
          e.preventDefault();
          onBrowseAll();
        }}
      >
        <LibraryIcon className="size-3.5 shrink-0" />
        Browse all skills…
      </button>
    </div>
  );
};
