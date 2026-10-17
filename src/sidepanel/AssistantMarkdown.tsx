import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { isSafeHttpUrl, sanitizeMarkdownUrl } from "../shared/protocol";
import { normalizeMathMarkdown } from "./math-markdown";

export default memo(function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", maxExpand: 1000, maxSize: 10 }]]}
      urlTransform={sanitizeMarkdownUrl}
      components={{
        img: () => null,
        a: ({ children, href, title }) => {
          const safeHref = href && isSafeHttpUrl(href) ? href : undefined;
          if (!safeHref) return <span>{children}</span>;
          return <a href={safeHref} title={title} target="_blank" rel="noreferrer noopener">{children}</a>;
        },
      }}
    >
      {normalizeMathMarkdown(text)}
    </ReactMarkdown>
  );
});
