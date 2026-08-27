/** Renderable segment produced from chat Markdown. */
export type ChatBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; language: string; code: string }
  | { kind: "mermaid"; code: string };

type Fence = {
  marker: string;
  language: string;
  lines: string[];
};

const openingFence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const closingFence = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** Split chat text into prose, fenced code, and Mermaid blocks. */
export function parseChatBlocks(markdown: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const textLines: string[] = [];
  let fence: Fence | undefined;

  const flushText = () => {
    const text = textLines.join("\n");
    textLines.length = 0;
    if (text.trim()) blocks.push({ kind: "text", text });
  };

  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    if (fence) {
      const closing = line.match(closingFence);
      if (
        closing &&
        closing[1][0] === fence.marker[0] &&
        closing[1].length >= fence.marker.length
      ) {
        const code = fence.lines.join("\n");
        blocks.push(
          fence.language === "mermaid"
            ? { kind: "mermaid", code }
            : { kind: "code", language: fence.language, code },
        );
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    const opening = line.match(openingFence);
    if (!opening) {
      textLines.push(line);
      continue;
    }

    flushText();
    fence = {
      marker: opening[1],
      language: opening[2].trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "",
      lines: [],
    };
  }

  if (fence) {
    const code = fence.lines.join("\n");
    blocks.push(
      fence.language === "mermaid"
        ? { kind: "mermaid", code }
        : { kind: "code", language: fence.language, code },
    );
  } else {
    flushText();
  }

  return blocks;
}
