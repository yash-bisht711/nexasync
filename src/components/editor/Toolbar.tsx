'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, Code, Quote, List, ListOrdered, ListChecks,
  Heading1, Heading2, Heading3, Pilcrow, Link as LinkIcon, Image as ImageIcon,
  Highlighter, Minus, Undo2, Redo2,
} from 'lucide-react';

type Props = { editor: Editor | null; disabled: boolean };

export default function Toolbar({ editor, disabled }: Props) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  if (!editor) return null;
  const ed = editor;

  const group = (items: React.ReactNode) => (
    <div className="flex items-center gap-0.5 border-r border-white/5 pr-1 last:border-0">{items}</div>
  );

  const button = (
    label: string,
    Icon: React.ComponentType<{ size?: number }>,
    run: () => void,
    active = false,
  ) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={run}
      className={`rounded-lg p-2 transition ${
        active ? 'bg-violet-500/25 text-violet-100' : 'text-slate-400 hover:bg-white/5 hover:text-white'
      } disabled:pointer-events-none disabled:opacity-25`}
    >
      <Icon size={16} />
    </button>
  );

  function applyLink(url: string) {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkDraft(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-3 py-2">
      {group([
        button('Paragraph', Pilcrow, () => editor.chain().focus().setParagraph().run(), editor.isActive('paragraph')),
        button('Heading 1', Heading1, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 })),
        button('Heading 2', Heading2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 })),
        button('Heading 3', Heading3, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 })),
      ])}
      {group([
        button('Bold', Bold, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')),
        button('Italic', Italic, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')),
        button('Underline', Underline, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline')),
        button('Strikethrough', Strikethrough, () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike')),
        button('Highlight', Highlighter, () => editor.chain().focus().toggleHighlight().run(), editor.isActive('highlight')),
      ])}
      {group([
        button('Bulleted list', List, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList')),
        button('Numbered list', ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList')),
        button('Checklist', ListChecks, () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList')),
      ])}
      {group([
        button('Quote', Quote, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote')),
        button('Code block', Code, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock')),
        button('Divider', Minus, () => editor.chain().focus().setHorizontalRule().run()),
      ])}
      {group([
        button('Link', LinkIcon, () => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          setLinkDraft('');
        }, editor.isActive('link')),
        button('Image', ImageIcon, () => {
          const url = window.prompt('Image URL');
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }),
      ])}
      <div className="ml-auto flex items-center gap-0.5">
        {button('Undo', Undo2, () => editor.chain().focus().undo().run())}
        {button('Redo', Redo2, () => editor.chain().focus().redo().run())}
      </div>

      {linkDraft && (
        <div className="absolute left-3 top-14 z-20 w-80 rounded-xl border border-white/10 bg-[#12151f] p-3 shadow-xl">
          <label className="block text-xs text-slate-400">
            URL
            <input
              autoFocus
              value={linkDraft}
              onChange={e => setLinkDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && linkDraft.trim()) applyLink(linkDraft.trim());
                if (e.key === 'Escape') setLinkDraft(null);
              }}
              placeholder="example.com"
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b0e17] px-2 py-2 text-sm text-white outline-none focus:border-violet-400"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!linkDraft.trim()}
              onClick={() => applyLink(linkDraft.trim())}
              className="flex-1 rounded-lg bg-violet-500/25 py-2 text-xs text-violet-100 disabled:opacity-30"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setLinkDraft(null)}
              className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
