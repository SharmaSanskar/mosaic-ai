"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders AI message text as Markdown. react-markdown renders NO raw HTML by
// default, so model output can't inject markup — no sanitizer needed. GFM adds
// tables, strikethrough, and autolinks. Element spacing lives in `.md-body`
// (globals.css) so it sits well inside a chat bubble.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
