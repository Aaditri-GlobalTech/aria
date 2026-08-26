import mermaid from "mermaid";
import { type BundledLanguage, codeToHtml } from "shiki";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { type ChatBlock, parseChatBlocks } from "./chat-markdown";

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

function HighlightedCode(props: { code: string; language: string }) {
  const [html, setHtml] = createSignal("");
  let revision = 0;

  createEffect(() => {
    const code = props.code;
    const language = props.language || "text";
    const currentRevision = ++revision;
    setHtml("");
    void codeToHtml(code, {
      lang: language as BundledLanguage,
      theme: "github-dark",
    })
      .then((highlighted) => {
        if (currentRevision === revision) setHtml(highlighted);
      })
      .catch(() => {
        if (currentRevision === revision) setHtml("");
      });
  });

  onCleanup(() => {
    revision += 1;
  });

  return (
    <Show
      when={html()}
      fallback={
        <pre class="agent-code-block">
          <code>{props.code}</code>
        </pre>
      }
    >
      <div class="agent-code-block" innerHTML={html()} />
    </Show>
  );
}

function ChatBlockView(props: { block: ChatBlock }) {
  if (props.block.kind === "text") {
    return <div class="agent-markdown-text">{props.block.text}</div>;
  }
  if (props.block.kind === "mermaid") {
    return <MermaidDiagram code={props.block.code} />;
  }
  return (
    <HighlightedCode code={props.block.code} language={props.block.language} />
  );
}

export function ChatMarkdown(props: { text: string }) {
  const blocks = () => parseChatBlocks(props.text);
  return (
    <div class="agent-markdown">
      <For each={blocks()}>{(block) => <ChatBlockView block={block} />}</For>
    </div>
  );
}
