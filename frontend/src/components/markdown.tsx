import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Uploads live in the attachment gallery; arbitrary Markdown URLs never own files.
          img: ({ alt }) => (
            <span className="text-muted-foreground">[图片：{alt || '请使用下方照片附件'}]</span>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
