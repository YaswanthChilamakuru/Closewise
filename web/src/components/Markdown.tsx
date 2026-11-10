import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Safe Markdown renderer (raw HTML is not rendered). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={`prose prose-sm prose-zinc max-w-none prose-headings:font-semibold prose-a:text-accent-600 prose-li:my-0.5 ${className ?? ""}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
