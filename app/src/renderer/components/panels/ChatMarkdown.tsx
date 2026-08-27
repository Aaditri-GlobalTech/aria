import { marked, Renderer } from "marked";
import mermaid from "mermaid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { CodeHighlight } from "./CodeHighlight";
import { type ChatBlock, parseChatBlocks } from "./chat-markdown";

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

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value, "https://aria.invalid");
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

const markdownRenderer = new Renderer();
markdownRenderer.html = ({ text }) => escapeHtml(text);
markdownRenderer.link = function ({ href, title, tokens }) {
  const safe = safeUrl(href);
  const label = this.parser.parseInline(tokens);
  if (!safe) return label;
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(safe)}"${titleAttribute}>${label}</a>`;
};
markdownRenderer.image = ({ href, title, text }) => {
  const safe = safeUrl(href);
  if (!safe) return escapeHtml(text);
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttribute}>`;
};

/** Render safe GitHub-flavored Markdown for chat text. */
export function renderMarkdown(text: string): string {
  return marked.parse(text, {
    async: false,
    breaks: true,
    gfm: true,
    renderer: markdownRenderer,
  });
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "dark",
});

let mermaidId = 0;

function MermaidDiagram(props: { code: string }) {
  const [svg, setSvg] = createSignal("");
  let revision = 0;

  createEffect(() => {
    const code = props.code;
    const currentRevision = ++revision;
    setSvg("");
    void mermaid
      .render(`aria-mermaid-${++mermaidId}`, code)
      .then((result) => {
        if (currentRevision === revision) setSvg(result.svg);
      })
      .catch(() => {
        if (currentRevision === revision) setSvg("");
      });
  });

  onCleanup(() => {
    revision += 1;
  });

  return (
    <Show
      when={svg()}
      fallback={
        <pre class="agent-code-block agent-mermaid-fallback">
          <code>{props.code}</code>
        </pre>
      }
    >
      <div class="agent-mermaid" innerHTML={svg()} />
    </Show>
  );
}

/** Render one sanitized Markdown fragment. */
export function MarkdownText(props: { text: string; className?: string }) {
  return (
    <div
      class={props.className ?? "agent-markdown-text"}
      innerHTML={renderMarkdown(props.text)}
    />
  );
}

function ChatBlockView(props: { block: ChatBlock }) {
  const block = props.block;
  if (block.kind === "text") {
    return <MarkdownText text={block.text} />;
  }
  if (block.kind === "mermaid") {
    return <MermaidDiagram code={block.code} />;
  }
  return (
    <CodeHighlight code={() => block.code} language={() => block.language} />
  );
}

/** Render chat text with fenced code and Mermaid blocks separated. */
export function ChatMarkdown(props: { text: string }) {
  const blocks = () => parseChatBlocks(props.text);
  return (
    <div class="agent-markdown">
      <For each={blocks()}>{(block) => <ChatBlockView block={block} />}</For>
    </div>
  );
}
