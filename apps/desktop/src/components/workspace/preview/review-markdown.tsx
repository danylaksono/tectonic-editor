import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ask } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

/**
 * Markdown for review comment bodies.
 *
 * Deliberately not the AI chat's renderer. That one turns code blocks into
 * "Insert into document" and "Run command" buttons, which is right for text
 * this user asked Claude to produce and wrong for a review comment: annotations
 * travel between people through the review round-trip, so a body here may have
 * been written by someone else. Nothing in this renderer executes, inserts, or
 * fetches anything.
 *
 * The real reason to have it at all is maths. Arguing with yourself about a
 * results chapter in plain text — "the estimator b-hat is only unbiased if..."
 * — is miserable; `$\hat\beta$` is not.
 */

/** Links leave the app, so they ask first — same contract as a link in the
 *  PDF itself (see openPdfHref in pdf-viewer). */
function openExternal(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  void ask(`Open in browser?\n${href}`, {
    title: "External Link",
    kind: "info",
    okLabel: "Open",
    cancelLabel: "Cancel",
  }).then((confirmed) => {
    if (confirmed) void shellOpen(href);
  });
}

interface ReviewMarkdownProps {
  content: string;
  className?: string;
}

export const ReviewMarkdown: FC<ReviewMarkdownProps> = ({
  content,
  className,
}) => (
  <div className={cn("text-sm leading-relaxed", className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        // Heading levels are flattened: a card in a 320px column has no room
        // for a hierarchy, and a `#` typed out of habit should not produce a
        // banner three times the size of the note under it.
        h1: ({ children }) => <Heading>{children}</Heading>,
        h2: ({ children }) => <Heading>{children}</Heading>,
        h3: ({ children }) => <Heading>{children}</Heading>,
        h4: ({ children }) => <Heading>{children}</Heading>,
        h5: ({ children }) => <Heading>{children}</Heading>,
        h6: ({ children }) => <Heading>{children}</Heading>,
        ul: ({ children }) => (
          <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">
            {children}
          </ol>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-muted-foreground/30 border-l-2 pl-2 text-muted-foreground last:mb-0">
            {children}
          </blockquote>
        ),
        // Inert: no language badge, no insert, no run.
        pre: ({ children }) => (
          <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs last:mb-0">
            {children}
          </pre>
        ),
        code: ({ className: codeClass, children }) =>
          codeClass?.startsWith("language-") ? (
            <code className="font-mono text-xs">{children}</code>
          ) : (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
              {children}
            </code>
          ),
        a: ({ href, children }) => (
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => href && openExternal(href)}
          >
            {children}
          </button>
        ),
        // Never fetched. The CSP would block a remote image anyway, leaving a
        // broken icon; the alt text at least says what was meant.
        img: ({ alt }) => (
          <span className="text-muted-foreground text-xs italic">
            {alt ? `[image: ${alt}]` : "[image]"}
          </span>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border px-1.5 py-0.5 text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-1.5 py-0.5">{children}</td>
        ),
        hr: () => <hr className="my-2 border-border" />,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const Heading: FC<{ children?: React.ReactNode }> = ({ children }) => (
  <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>
);
