import "server-only";
import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type BundledTheme,
} from "shiki";

const THEME: BundledTheme = "min-dark";

const LANGS: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "ruby",
  "php",
  "swift",
  "c",
  "cpp",
  "csharp",
  "css",
  "scss",
  "html",
  "json",
  "jsonc",
  "markdown",
  "mdx",
  "sql",
  "shell",
  "yaml",
  "toml",
  "xml",
  "docker",
  "diff",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: LANGS,
    });
  }
  return highlighterPromise;
}

function isLoaded(h: Highlighter, lang: string): boolean {
  return h.getLoadedLanguages().includes(lang as BundledLanguage);
}

function safeLang(h: Highlighter, lang: string): BundledLanguage | "text" {
  return isLoaded(h, lang) ? (lang as BundledLanguage) : "text";
}

export async function highlightFile(
  contents: string,
  lang: string,
): Promise<string> {
  const h = await getHighlighter();
  return h.codeToHtml(contents, {
    lang: safeLang(h, lang),
    theme: THEME,
  });
}

/**
 * Highlight a unified diff. Shiki's "diff" grammar handles +/-/@@ lines
 * with sensible colors; we wrap the result so the +/- background tints
 * read clearly against the app surface.
 */
export async function highlightDiff(patch: string): Promise<string> {
  const h = await getHighlighter();
  return h.codeToHtml(patch || "(no changes)", {
    lang: "diff",
    theme: THEME,
  });
}
