import { describe, it, expect } from "vitest";
import {
  matchSkillTrigger,
  rankSkills,
} from "@/components/ai-chat/skill-picker";
import { BUILTIN_SKILLS } from "@/lib/skills/builtin";
import type { Skill } from "@/lib/skills/types";

describe("matchSkillTrigger", () => {
  it("opens on a bare slash with an empty query", () => {
    expect(matchSkillTrigger("/")).toBe("");
  });

  it("captures the query after the slash", () => {
    expect(matchSkillTrigger("/proof")).toBe("proof");
  });

  it("does not trigger mid-sentence", () => {
    // LaTeX prose is full of slashes — these must stay literal text
    expect(matchSkillTrigger("write \\frac{1}{2} / 3")).toBeNull();
    expect(matchSkillTrigger("see and/or")).toBeNull();
    expect(matchSkillTrigger("fix the \\textbf/emph mix")).toBeNull();
  });

  it("does not trigger on a leading command sequence", () => {
    expect(matchSkillTrigger("\\section{Intro}")).toBeNull();
  });

  it("closes once the query gains whitespace", () => {
    // "/proofread this chapter" is a sentence, not a skill invocation
    expect(matchSkillTrigger("/proofread this")).toBeNull();
    expect(matchSkillTrigger("/ ")).toBeNull();
  });

  it("does not trigger on empty input", () => {
    expect(matchSkillTrigger("")).toBeNull();
  });
});

describe("rankSkills", () => {
  it("returns every skill for an empty query, in order", () => {
    expect(rankSkills("", BUILTIN_SKILLS)).toHaveLength(BUILTIN_SKILLS.length);
  });

  it("ranks an exact name first", () => {
    expect(rankSkills("explain", BUILTIN_SKILLS)[0].name).toBe("explain");
  });

  it("matches on the title as well as the name", () => {
    const skills: Skill[] = [
      {
        name: "xyz",
        title: "Proofread",
        description: "d",
        body: "b",
        source: "user",
        warnings: [],
      },
    ];
    expect(rankSkills("proofread", skills)).toHaveLength(1);
  });

  it("matches on the description by substring", () => {
    const found = rankSkills("bibliography", BUILTIN_SKILLS);
    expect(found.map((s) => s.name)).toContain("find-references");
  });

  it("tolerates a single typo", () => {
    expect(rankSkills("proofraed", BUILTIN_SKILLS)[0].name).toBe("proofread");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(rankSkills("zzzzqqq", BUILTIN_SKILLS)).toEqual([]);
  });
});
