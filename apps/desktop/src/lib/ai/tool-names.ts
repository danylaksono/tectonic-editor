/**
 * The names of the tools in `AI_TOOL_DEFINITIONS`, split into their own module
 * so that validating a skill's `tools:` allowlist does not have to import
 * `tools.ts` (which pulls in the document store, the compiler and the
 * bibliography resolver).
 *
 * `tools.test.ts` asserts this list stays in sync with the real definitions.
 */
export const AI_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_project",
  "propose_edit",
  "compile_document",
  "read_build_log",
  "check_citations",
  "search_references",
  "lookup_reference",
  "add_citation",
  "run_python",
  "install_python_packages",
  "read_skill_file",
] as const;

/**
 * Tools that do something irreversible or outside the document — a skill
 * declaring one of these gets a prominent warning in the picker and gallery
 * rather than being listed as just another entry in a comma-separated list.
 */
export const DANGEROUS_TOOL_NAMES: readonly string[] = [
  "run_python",
  "install_python_packages",
];

export type AiToolName = (typeof AI_TOOL_NAMES)[number];
