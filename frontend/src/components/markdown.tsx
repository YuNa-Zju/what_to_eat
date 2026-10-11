import { lazy, memo, Suspense } from 'react';
import { LazyBoundary } from './lazy-boundary';

const MarkdownContent = lazy(() => import('./markdown-content'));

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const fallback = <div className="markdown whitespace-pre-wrap">{children}</div>;
  return (
    <LazyBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MarkdownContent>{children}</MarkdownContent>
      </Suspense>
    </LazyBoundary>
  );
});
