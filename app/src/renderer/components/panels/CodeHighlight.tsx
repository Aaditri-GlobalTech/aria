import hljs from "highlight.js/lib/common";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

export type CodeHighlightProps = {
  code: () => string;
  language: () => string;
  className?: string | (() => string);
  lineNumbers?: boolean | (() => boolean);
  lineNumberStart?: () => number;
  onScroll?: (event: Event) => void;
  setElement?: (element: HTMLElement) => void;
};

type HighlightedLine = {
  number: number;
  text: string;
  html?: string;
};

const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

/** Map a tool file path to a Highlight.js language alias. */
export function languageForFile(path: string): string {
  const filename = path.replaceAll("\\", "/").split("/").pop() ?? "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";

  const extension = filename.split(".").pop()?.toLowerCase();
  return extension && extension !== filename ? extension : "";
}

function lineStart(value: number | undefined) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.trunc(value))
    : 1;
}

function highlightedLines(
  code: string,
  start: number,
  language?: string,
): HighlightedLine[] {
  return code
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((text, index) => {
      if (!language) return { number: start + index, text };
      if (
        language === "diff" &&
        (text.startsWith("-") || text.startsWith("+"))
      ) {
        const type = text.startsWith("+") ? "addition" : "deletion";
        return {
          number: start + index,
          text,
          html: `${escapeHtml(text[0] ?? "")}<span class="hljs-${type}">${escapeHtml(text.slice(1))}</span>`,
        };
      }
      try {
        return {
          number: start + index,
          text,
          html: hljs.highlight(text, { language }).value,
        };
      } catch {
        return { number: start + index, text };
      }
    });
}

/** Highlight only explicitly identified languages; plain text stays plain. */
export function CodeHighlight(props: CodeHighlightProps) {
  const [html, setHtml] = createSignal("");
  const [lines, setLines] = createSignal<HighlightedLine[]>([]);
  const className = () =>
    typeof props.className === "function"
      ? props.className()
      : (props.className ?? "agent-code-block");
  const withLineNumbers = () =>
    typeof props.lineNumbers === "function"
      ? props.lineNumbers()
      : props.lineNumbers === true;
  let revision = 0;

  createEffect(() => {
    const code = props.code();
    const language = props.language();
    const withLineNumbers =
      typeof props.lineNumbers === "function"
        ? props.lineNumbers()
        : props.lineNumbers === true;
    const start = lineStart(props.lineNumberStart?.());
    const currentRevision = ++revision;
    setHtml("");
    setLines(withLineNumbers ? highlightedLines(code, start) : []);
    const timer = setTimeout(() => {
      if (currentRevision !== revision) return;

      const supportedLanguage =
        language && hljs.getLanguage(language) ? language : undefined;
      if (withLineNumbers) {
        setLines(highlightedLines(code, start, supportedLanguage));
        return;
      }
      if (!supportedLanguage) return;
      try {
        setHtml(hljs.highlight(code, { language: supportedLanguage }).value);
      } catch {
        setHtml("");
      }
    }, 0);

    onCleanup(() => {
      revision += 1;
      clearTimeout(timer);
    });
  });

  const setElement = (element: HTMLElement) => props.setElement?.(element);

  return (
    <Show
      when={withLineNumbers() ? lines().length > 0 : html()}
      fallback={
        <pre ref={setElement} class={className()} on:scroll={props.onScroll}>
          <code>{props.code()}</code>
        </pre>
      }
    >
      <Show
        when={withLineNumbers()}
        fallback={
          <div
            ref={setElement}
            class={className()}
            on:scroll={props.onScroll}
            innerHTML={html()}
          />
        }
      >
        <div
          ref={setElement}
          class={`${className()} agent-editor-output`}
          on:scroll={props.onScroll}
        >
          <For each={lines()}>
            {(line) => (
              <span class="agent-tool-line">
                <span class="agent-tool-line-number" aria-hidden="true">
                  {line.number}
                </span>
                <span class="agent-tool-line-content">
                  <Show when={line.html !== undefined} fallback={line.text}>
                    <span innerHTML={line.html ?? ""} />
                  </Show>
                </span>
              </span>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
