import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  levenshtein,
  typoScore,
  scoreFields,
  fuzzyRank,
  type FuzzyFields,
} from "./fuzzy-search";

// ─── Test data ───

interface Entry {
  name: string;
  description: string | null;
}

const toFields = (e: Entry): FuzzyFields => ({
  primary: e.name,
  description: e.description,
});

const ENTRIES: Entry[] = [
  {
    name: "biorxiv-database",
    description: "Efficient database search tool for bioRxiv preprint server.",
  },
  {
    name: "biopython",
    description: "Comprehensive molecular biology toolkit.",
  },
  {
    name: "bioservices",
    description: "Unified Python interface to 40+ bioinformatics services.",
  },
  {
    name: "cbioportal-database",
    description: "Query cBioPortal for cancer genomics data.",
  },
  { name: "scikit-bio", description: "Biological data toolkit." },
  {
    name: "scvi-tools",
    description: "Deep generative models for single-cell omics.",
  },
  { name: "vaex", description: "Large tabular datasets." },
  { name: "deepchem", description: "Molecular ML with diverse featurizers." },
  {
    name: "market-research-reports",
    description: "Market research reports.",
  },
  { name: "matlab", description: "MATLAB and GNU Octave." },
  { name: "scanpy", description: "scRNA-seq analysis." },
  { name: "phylogenetics", description: "Phylogenetic trees." },
  { name: "perplexity-search", description: "AI-powered web searches." },
  {
    name: "latchbio-integration",
    description: "Latch platform for bioinformatics.",
  },
];

const search = (q: string) =>
  fuzzyRank(q, ENTRIES, toFields).map((e) => e.name);

// ─── Tests ───

describe("fuzzyScore", () => {
  it("exact prefix match scores high", () => {
    expect(fuzzyScore("bio", "biopython")).toBeGreaterThan(0);
  });

  it("subsequence match works", () => {
    expect(fuzzyScore("bpy", "biopython")).toBeGreaterThan(-Infinity);
  });

  it("non-matching returns -Infinity", () => {
    expect(fuzzyScore("xyz", "biopython")).toBe(-Infinity);
  });

  it("extra char in query fails subsequence", () => {
    // bioarxiv has 'a' that doesn't exist in biorxiv in order
    expect(fuzzyScore("bioarxiv", "biorxiv-database")).toBe(-Infinity);
  });

  it("empty query scores 0", () => {
    expect(fuzzyScore("", "biopython")).toBe(0);
  });
});

describe("levenshtein", () => {
  it("identical strings = 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("one insertion = 1", () => {
    expect(levenshtein("bioarxiv", "biorxiv")).toBe(1);
  });
  it("one substitution = 1", () => {
    expect(levenshtein("scanpy", "scnpy")).toBe(1);
  });
});

describe("typoScore", () => {
  it("bioarxiv matches biorxiv-database", () => {
    expect(typoScore("bioarxiv", "biorxiv-database")).toBeGreaterThan(
      -Infinity,
    );
  });

  it("bioarxiv does NOT match cbioportal-database", () => {
    expect(typoScore("bioarxiv", "cbioportal-database")).toBe(-Infinity);
  });

  it("scnpy matches scanpy", () => {
    expect(typoScore("scnpy", "scanpy")).toBeGreaterThan(-Infinity);
  });
});

describe("scoreFields", () => {
  it("bioarxiv matches biorxiv-database via typo fallback", () => {
    const entry = ENTRIES.find((e) => e.name === "biorxiv-database")!;
    expect(scoreFields("bioarxiv", toFields(entry))).toBeGreaterThan(-Infinity);
  });

  it("a subsequence match outranks a typo match", () => {
    const subsequence = scoreFields("bio", { primary: "biopython" });
    const typo = scoreFields("bioarxiv", { primary: "biorxiv-database" });
    expect(subsequence).toBeGreaterThan(typo);
  });

  it("matches the secondary field when the primary does not", () => {
    const score = scoreFields("proofread", {
      primary: "pr",
      secondary: "Proofread",
    });
    expect(score).toBeGreaterThan(-Infinity);
  });

  it("description matches by substring only", () => {
    // "toolkit" is a substring of the description but not a subsequence of the name
    expect(
      scoreFields("toolkit", {
        primary: "biopython",
        description: "Comprehensive molecular biology toolkit.",
      }),
    ).toBeGreaterThan(-Infinity);
    expect(
      scoreFields("tkt", {
        primary: "biopython",
        description: "Comprehensive molecular biology toolkit.",
      }),
    ).toBe(-Infinity);
  });
});

describe("fuzzyRank", () => {
  it("'bioarxiv' should have biorxiv-database as top result", () => {
    expect(search("bioarxiv")[0]).toBe("biorxiv-database");
  });

  it("'bioarxiv' should NOT match cbioportal-database", () => {
    expect(search("bioarxiv")).not.toContain("cbioportal-database");
  });

  it("'bio' should have biopython and biorxiv-database near top", () => {
    const top = search("bio").slice(0, 5);
    expect(top).toContain("biopython");
    expect(top).toContain("biorxiv-database");
  });

  it("'bpy' subsequence should match biopython", () => {
    expect(search("bpy")).toContain("biopython");
  });

  it("'scanpy' exact should be top result", () => {
    expect(search("scanpy")[0]).toBe("scanpy");
  });

  it("'matlab' exact should be top result", () => {
    expect(search("matlab")[0]).toBe("matlab");
  });

  it("empty query returns everything in original order", () => {
    expect(search("")).toEqual(ENTRIES.map((e) => e.name));
  });
});
