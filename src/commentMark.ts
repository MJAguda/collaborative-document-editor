import { Mark } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import type { Node as ProseNode } from '@tiptap/pm/model';

// A highlighted range tied to a comment: <span data-comment-id="N">. The server sanitiser allows exactly this attribute (digits only).
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false, // typing at the edge does not extend the highlight
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => ({ 'data-comment-id': attrs.commentId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});

export type Anchor = { from: number; to: number; text: string };

// Where each comment id is highlighted in the document (one entry per id, from the first to the last marked text).
export function findAnchors(doc: ProseNode): Record<string, Anchor> {
  const found: Record<string, Anchor> = {};
  doc.descendants((node, pos) => {
    const m = node.isText ? node.marks.find((x) => x.type.name === 'comment') : undefined;
    if (!m) return;
    const id = String(m.attrs.commentId);
    const a = (found[id] ??= { from: pos, to: pos, text: '' });
    a.to = pos + node.nodeSize;
    a.text += node.text;
  });
  return found;
}

// Removes the highlight for one comment id everywhere (the editor's update event then triggers autosave).
export function removeCommentMark(editor: Editor, id: number) {
  const { doc, tr } = editor.state;
  doc.descendants((node, pos) => {
    const m = node.marks.find((x) => x.type.name === 'comment' && String(x.attrs.commentId) === String(id));
    if (m) tr.removeMark(pos, pos + node.nodeSize, m);
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}
