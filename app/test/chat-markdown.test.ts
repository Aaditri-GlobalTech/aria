import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/renderer/components/panels/ChatMarkdown";
import { languageForFile } from "../src/renderer/components/panels/CodeHighlight";
import { parseChatBlocks } from "../src/renderer/components/panels/chat-markdown";

describe("chat markdown", () => {
  it("maps tool file paths to highlight languages", () => {
    expect(languageForFile("src/app.tsx")).toBe("tsx");
    expect(languageForFile("src/config.yaml")).toBe("yaml");
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("output.log")).toBe("log");
  });

  it("renders emphasis, lists, and safe links", () => {
    const html = renderMarkdown(
      "***Building and launching new release***\n\n- `read` output",
    );
    expect(html).toContain(
      "<em><strong>Building and launching new release</strong></em>",
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<code>read</code>");
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain(
      "<script>",
    );
    expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain("<a ");
  });

  it("renders the full message Markdown surface", () => {
    const html = renderMarkdown(
      "# Heading\n\n1. **bold** and *italic*\n\n> quote\n\n~~removed~~\n\n| key | value |\n| --- | --- |\n| one | two |",
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("<table>");
  });

  it("separates fenced code and Mermaid blocks from chat text", () => {
    expect(
      parseChatBlocks(
        "Before\n\n```ts\nconst answer = 42;\n```\n\n```mermaid\ngraph TD\n  A --> B\n```",
      ),
    ).toEqual([
      { kind: "text", text: "Before\n" },
      { kind: "code", language: "ts", code: "const answer = 42;" },
      { kind: "mermaid", code: "graph TD\n  A --> B" },
    ]);
  });
});
