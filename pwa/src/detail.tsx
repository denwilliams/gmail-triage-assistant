import { useEffect, useRef, useState } from 'react';
import type { Bucket, EmailContent, EmailItem } from './types';
import { BUCKETS } from './types';
import { api, gmailLink } from './api';
import { BUCKET_META, formatDayTime, initials, senderDisplay } from './lib';
import { BUCKET_ICONS, Icon } from './icons';
import { metaChips } from './rows';

/**
 * Untrusted email HTML rendered in a sandboxed iframe. No allow-scripts, so
 * nothing executes; allow-same-origin lets us measure the height. Links open
 * in a new tab via an injected <base>.
 */
function MailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  const doc = `<!doctype html><html><head><base target="_blank">
    <meta name="color-scheme" content="light">
    <style>
      body { margin: 12px; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
             font-size: 14px; line-height: 1.5; color: #1a1a1a; word-break: break-word; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
    </style></head><body>${html}</body></html>`;

  const measure = () => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight + 28, 120), 20000));
  };

  useEffect(() => {
    // Images load after onLoad fires — re-measure a few times.
    const timers = [300, 1000, 2500].map((ms) => setTimeout(measure, ms));
    return () => timers.forEach(clearTimeout);
  }, [html]);

  return (
    <iframe
      ref={ref}
      className="mail-frame"
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
      onLoad={measure}
    />
  );
}

export function DetailView({
  email,
  rating,
  tz,
  onArchive,
  onTrash,
  onMove,
  toast,
}: {
  email: EmailItem;
  rating?: number | null;
  tz?: string;
  onArchive: (e: EmailItem) => void;
  onTrash: (e: EmailItem) => void;
  onMove: (e: EmailItem, bucket: Bucket) => void;
  toast: (msg: string) => void;
}) {
  const [content, setContent] = useState<EmailContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentReply, setSentReply] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setContentError(null);
    setComposerOpen(false);
    setReplyText('');
    setSentReply(null);
    setMoveOpen(false);
    api.content(email.id).then(
      (c) => {
        if (!cancelled) setContent(c);
      },
      (err: unknown) => {
        if (!cancelled) setContentError(err instanceof Error ? err.message : 'Failed to load');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [email.id]);

  useEffect(() => {
    if (composerOpen) textareaRef.current?.focus();
  }, [composerOpen]);

  const display = senderDisplay(content?.from_header || email.from_address);
  const b = email.bucket;

  const send = async () => {
    const body = replyText.trim();
    if (!body) {
      toast('Write something first');
      return;
    }
    setSending(true);
    try {
      await api.reply(email.id, body);
      setSentReply(body);
      setComposerOpen(false);
      setReplyText('');
      toast('Reply sent via your Gmail');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="d-scroll">
        <h1 className="d-subject">{email.subject || '(no subject)'}</h1>
        <div className="d-chips">
          <span className="chip" style={{ ['--bc' as string]: `var(--c-${b})` }}>
            <span className="bucket-dot" />
            {BUCKET_META[b].name}
          </span>
          {metaChips(email, rating)}
        </div>
        <div className="d-sender" style={{ ['--bc' as string]: `var(--c-${b})` }}>
          <span className="avatar">{initials(display.name)}</span>
          <span className="who">
            <span className="nm">{display.name}</span>
            <span className="em">{display.email}</span>
          </span>
          <span className="tm">{formatDayTime(email.processed_at, tz)}</span>
        </div>
        {email.summary && (
          <div className="ai-note">
            {Icon.newsletter()}
            <span>
              <b>Summary:</b> {email.summary}
            </span>
          </div>
        )}
        {!content && !contentError && <div className="d-loading">Loading message…</div>}
        {contentError && <div className="d-loading">{contentError} — try opening in Gmail.</div>}
        {content && (
          content.html ? (
            <div className="d-body">
              <MailFrame html={content.html} />
            </div>
          ) : (
            <div className="d-body textonly">{content.text || '(empty message)'}</div>
          )
        )}
        {sentReply && (
          <div className="reply-bubble">
            <div className="h">You replied · just now</div>
            {sentReply}
          </div>
        )}
      </div>

      {composerOpen && (
        <div className="composer">
          <div className="to">
            Replying to <b>{display.name}</b> ‹{display.email}› · sent from your Gmail
          </div>
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={(ev) => setReplyText(ev.target.value)}
            placeholder="Write your reply…"
          />
          <div className="crow">
            <button className="abtn primary" onClick={send} disabled={sending}>
              {Icon.send()}
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button className="abtn" onClick={() => setComposerOpen(false)} disabled={sending}>
              Cancel
            </button>
            <span className="hint">Appears in your Gmail Sent folder</span>
          </div>
        </div>
      )}

      {!composerOpen && (
        <div className="d-actions" style={{ position: 'relative' }}>
          <button className="abtn primary" onClick={() => setComposerOpen(true)}>
            {Icon.reply()}
            Reply
          </button>
          <button className="abtn" onClick={() => onArchive(email)}>
            {Icon.archive()}
            Archive
          </button>
          <button className="abtn" onClick={() => setMoveOpen((v) => !v)}>
            {Icon.folder()}
            Move to…
          </button>
          <span style={{ flex: 1 }} />
          <button className="abtn iconly" title="Move to Trash" onClick={() => onTrash(email)}>
            {Icon.trash()}
          </button>
          <a
            className="abtn iconly"
            title="Open in Gmail"
            href={gmailLink(email)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {Icon.external()}
          </a>
          {moveOpen && (
            <div className="menu-pop" role="menu">
              {BUCKETS.filter((x) => x !== b).map((x) => (
                <button
                  key={x}
                  style={{ ['--bc' as string]: `var(--c-${x})` }}
                  onClick={() => {
                    setMoveOpen(false);
                    onMove(email, x);
                  }}
                >
                  <span style={{ color: `var(--c-${x})`, display: 'inline-flex' }}>{BUCKET_ICONS[x]()}</span>
                  {BUCKET_META[x].name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
