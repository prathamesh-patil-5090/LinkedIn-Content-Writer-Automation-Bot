'use client';

import { useRef, type RefObject } from 'react';
import {
  LINKEDIN_STYLE_CHIPS,
  applyLinkedInStyleToRange,
  type LinkedInTextStyle,
} from '@/lib/linkedin-text-format';

type Props = {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
};

export function LinkedInFormatToolbar({
  value,
  onChange,
  textareaRef,
  disabled,
}: Props) {
  const hintRef = useRef<HTMLSpanElement>(null);

  function apply(style: LinkedInTextStyle) {
    if (disabled) return;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    const { text, start: s, end: e } = applyLinkedInStyleToRange(
      value,
      start,
      end,
      style,
    );
    onChange(text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(s, e);
    });
    if (start === end && hintRef.current) {
      hintRef.current.textContent =
        'Tip: select text first to format a phrase; no selection formats the whole post.';
      window.setTimeout(() => {
        if (hintRef.current) hintRef.current.textContent = '';
      }, 3200);
    }
  }

  return (
    <div className="li-format">
      <div className="li-format-bar">
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Bold Sans (LinkedIn-friendly)"
          onClick={() => apply('Bold Sans')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Italic Sans"
          onClick={() => apply('Italic Sans')}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Underline"
          onClick={() => apply('Underline')}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Strikethrough"
          onClick={() => apply('Strikethrough')}
        >
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </button>
        <span className="li-format-sep" aria-hidden />
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Bullet points"
          onClick={() => apply('Bullet Points')}
        >
          •
        </button>
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Numbered list"
          onClick={() => apply('Numbered List')}
        >
          1.
        </button>
        <button
          type="button"
          className="li-format-btn"
          disabled={disabled}
          title="Reset to normal"
          onClick={() => apply('Normal')}
        >
          Aa
        </button>
      </div>
      <div className="li-format-chips">
        {LINKEDIN_STYLE_CHIPS.map((style) => (
          <button
            key={style}
            type="button"
            className="li-format-chip"
            disabled={disabled}
            onClick={() => apply(style)}
          >
            {style}
          </button>
        ))}
      </div>
      <span ref={hintRef} className="li-format-hint muted" />
    </div>
  );
}
