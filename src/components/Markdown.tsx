import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// react-markdown does not render raw HTML, so it is safe for model output.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
