import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false });

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && text[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

function normalizeProse(text: string): string {
  let result = "";
  for (let index = 0; index < text.length;) {
    const bracket = text[index] === "\\" && !escaped(text, index) && ["[", "("].includes(text[index + 1]);
    const dollar = text[index] === "$" && !escaped(text, index) && text[index - 1] !== "$" && !/[\s$]/.test(text[index + 1] ?? " ");
    if (bracket || dollar) {
      const display = bracket && text[index + 1] === "[";
      const close = bracket ? display ? "\\]" : "\\)" : "$";
      const start = index + (bracket ? 2 : 1);
      let end = text.indexOf(close, start);
      while (end >= 0 && escaped(text, end)) end = text.indexOf(close, end + close.length);
      // A price such as "$5–$10" must remain prose, rather than opening math.
      const valid = end >= 0 && (bracket || (!/\s/.test(text[end - 1]) && !/[\d$]/.test(text[end + 1] ?? "") && !text.slice(start, end).includes("\n")));
      if (valid) {
        const value = text.slice(start, end).trim();
        result += value ? display ? `\n\n$$\n${value}\n$$\n\n` : `$$${value}$$` : text.slice(index, end + close.length);
        index = end + close.length;
        continue;
      }
      if (bracket && end < 0) return result + text.slice(index); // Incomplete streamed delimiter.
    }
    result += text[index++];
  }
  return result;
}

/** Adapt common model LaTeX delimiters before Markdown consumes their escapes. */
export function normalizeMathMarkdown(text: string): string {
  if (!/[\\$]/.test(text)) return text;
  const protectedRanges: Array<[number, number]> = [];
  function collect(node: Nodes): void {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const explicitLink = node.type === "link" && start !== undefined && ["[", "<"].includes(text[start]);
    if (["code", "inlineCode", "html", "image", "definition", "math", "inlineMath"].includes(node.type) || explicitLink) {
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end]);
      return;
    }
    if ("children" in node) node.children.forEach(collect);
  }
  collect(parser.parse(text));
  let result = "";
  let cursor = 0;
  for (const [start, end] of protectedRanges) {
    result += normalizeProse(text.slice(cursor, start)) + text.slice(start, end);
    cursor = end;
  }
  return result + normalizeProse(text.slice(cursor));
}
