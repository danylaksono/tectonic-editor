import {
  BookMarkedIcon,
  HelpCircleIcon,
  PenLineIcon,
  SparklesIcon,
  SpellCheckIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Icons a skill's `icon:` field may name. Deliberately a small allowlist rather
 * than a dynamic lookup over all of lucide — an unknown name falls back to
 * Sparkles instead of pulling the entire icon set into the bundle.
 */
const SKILL_ICONS: Record<string, LucideIcon> = {
  "spell-check": SpellCheckIcon,
  wrench: WrenchIcon,
  "pen-line": PenLineIcon,
  "help-circle": HelpCircleIcon,
  "book-marked": BookMarkedIcon,
  sparkles: SparklesIcon,
};

export function getSkillIcon(name?: string): LucideIcon {
  return (name ? SKILL_ICONS[name] : undefined) ?? SparklesIcon;
}
