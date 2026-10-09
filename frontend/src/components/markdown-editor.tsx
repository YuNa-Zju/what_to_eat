import { useId, useRef, useState } from 'react';
import {
  Bold,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Code2,
  Eye,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from './markdown';
import { cn } from '@/lib/utils';

const tools = [
  { label: '粗体', icon: Bold, before: '**', after: '**', placeholder: '重点' },
  { label: '斜体', icon: Italic, before: '*', after: '*', placeholder: '文字' },
  { label: '标题', icon: Heading2, before: '## ', after: '', placeholder: '小标题', line: true },
  {
    label: '无序列表',
    icon: List,
    before: '- ',
    after: '',
    placeholder: '一道好吃的菜',
    line: true,
  },
  {
    label: '有序列表',
    icon: ListOrdered,
    before: '1. ',
    after: '',
    placeholder: '第一点',
    line: true,
  },
  { label: '引用', icon: Quote, before: '> ', after: '', placeholder: '引用', line: true },
  { label: '链接', icon: Link, before: '[', after: '](https://)', placeholder: '链接文字' },
  { label: '代码', icon: Code2, before: '`', after: '`', placeholder: '代码' },
];
export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [preview, setPreview] = useState(false);
  const id = useId();
  function insert(tool: (typeof tools)[number]) {
    const { start, end } = selection.current;
    const selected = value.slice(start, end) || tool.placeholder;
    const prefix = tool.line && start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const before = prefix + tool.before;
    onChange(value.slice(0, start) + before + selected + tool.after + value.slice(end));
    setPreview(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-surface" aria-label="Markdown 编辑器">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 p-1.5">
        <div
          className="flex min-w-0 overflow-x-auto horizontal-scroll"
          role="toolbar"
          aria-label="文字格式"
        >
          {tools.map((tool) => (
            <Button
              type="button"
              key={tool.label}
              variant="ghost"
              size="icon"
              className="touch-button shrink-0"
              aria-label={tool.label}
              title={tool.label}
              disabled={disabled}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => insert(tool)}
            >
              <tool.icon className="size-4" />
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="touch-button shrink-0 lg:hidden"
          aria-controls={`${id}-preview`}
          aria-pressed={preview}
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? <Pencil className="mr-1.5 size-4" /> : <Eye className="mr-1.5 size-4" />}
          {preview ? '编辑' : '预览'}
        </Button>
      </div>
      <div className="lg:grid lg:grid-cols-2">
        <div className={cn('min-w-0', preview && 'hidden lg:block')}>
          <label htmlFor={`${id}-input`} className="sr-only">
            用餐感受，支持 Markdown
          </label>
          <Textarea
            ref={input}
            id={`${id}-input`}
            value={value}
            disabled={disabled}
            maxLength={10000}
            onChange={(e) => onChange(e.target.value)}
            onSelect={(e) => {
              selection.current = {
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              };
            }}
            placeholder={'今天吃得怎么样？\n\n写写推荐的菜、口味，或者下次还想不想来。'}
            className="markdown-input min-h-60 resize-y rounded-none border-0 p-4 text-base leading-7 shadow-none focus-visible:ring-0 lg:min-h-72"
          />
        </div>
        <div
          id={`${id}-preview`}
          className={cn(
            'min-h-60 min-w-0 overflow-x-auto p-4 lg:block lg:border-l',
            !preview && 'hidden',
          )}
        >
          <p className="mb-4 text-xs text-muted-foreground">预览</p>
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm leading-7 text-muted-foreground">
              写下第一句，预览会出现在这里。
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-xs text-muted-foreground">
        <span>支持 Markdown · 照片在下方添加</span>
        <span>{value.length}/10000</span>
      </div>
    </section>
  );
}
