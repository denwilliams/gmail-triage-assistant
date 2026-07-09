import { useRef } from 'react';
import type { EmailItem, RangeId } from './types';
import { BUCKET_META, initials, rowTime, senderDisplay } from './lib';
import { Icon } from './icons';

export interface RowActions {
  open: (e: EmailItem) => void;
  archive: (e: EmailItem) => void;
  openGmail: (e: EmailItem) => void;
  setCollapsed?: (e: EmailItem, collapsed: boolean) => void;
}

/**
 * Swipe-left-to-archive wrapper. Pointer-based so it works with both touch
 * and mouse drags; a drag past the threshold archives, anything shorter
 * snaps back and swallows the click so it doesn't open the email.
 */
export function SwipeRow({ onArchive, children }: { onArchive: () => void; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; dx: number; active: boolean } | null>(null);

  const row = () => wrapRef.current?.querySelector<HTMLElement>('.erow, .cal-item');
  const under = () => wrapRef.current?.querySelector<HTMLElement>('.swipe-under');

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    drag.current = { x0: ev.clientX, dx: 0, active: true };
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d?.active) return;
    d.dx = Math.min(0, ev.clientX - d.x0);
    const r = row();
    const u = under();
    if (r) {
      r.style.transform = `translateX(${d.dx}px)`;
      r.style.transition = 'none';
    }
    if (u) u.style.opacity = String(Math.min(1, -d.dx / 70));
  };
  const finish = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d?.active) return;
    d.active = false;
    const r = row();
    const u = under();
    if (d.dx < -90) {
      onArchive();
    } else if (r) {
      r.style.transition = 'transform 0.18s';
      r.style.transform = '';
      if (u) u.style.opacity = '0';
    }
    // A real drag must not fall through as a click on the row button.
    if (d.dx < -4) {
      ev.preventDefault();
      const stop = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      wrapRef.current?.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => wrapRef.current?.removeEventListener('click', stop, { capture: true }), 120);
    }
    drag.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="rowwrap"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div className="swipe-under" aria-hidden="true">
        {Icon.archive()}Archive
      </div>
      {children}
    </div>
  );
}

export function RowTools({ e, actions, collapsible }: { e: EmailItem; actions: RowActions; collapsible?: boolean }) {
  return (
    <div className="row-tools">
      <button
        className="tool-btn"
        title="Open in Gmail"
        aria-label="Open in Gmail"
        onClick={(ev) => {
          ev.stopPropagation();
          actions.openGmail(e);
        }}
      >
        {Icon.external()}
      </button>
      {collapsible && actions.setCollapsed && (
        <button
          className="tool-btn"
          title="Collapse"
          aria-label="Collapse email"
          onClick={(ev) => {
            ev.stopPropagation();
            actions.setCollapsed!(e, true);
          }}
        >
          {Icon.collapse()}
        </button>
      )}
    </div>
  );
}

export function metaChips(e: EmailItem, rating?: number | null): React.ReactNode[] {
  const chips: React.ReactNode[] = [];
  if (e.bucket === 'human' && rating !== undefined && rating !== null) {
    chips.push(<span key="rating" className="metachip">rating {rating}</span>);
  }
  if (e.severity) {
    chips.push(
      <span key="sev" className={`metachip${e.severity === 'high' || e.severity === 'critical' ? ' hot' : ''}`}>
        sev {e.severity}
      </span>,
    );
  }
  if (e.bucket === 'security' && !e.is_otp && e.action_type) {
    chips.push(<span key="act" className="metachip hot">{e.action_type.replace(/_/g, ' ')}</span>);
  }
  if (e.is_otp) {
    chips.push(<span key="otp" className="metachip warm">otp</span>);
  }
  if (e.interesting_score !== null) {
    chips.push(<span key="score" className="metachip">score {e.interesting_score}/10</span>);
  }
  if (e.document_type) {
    chips.push(<span key="doc" className="metachip">{e.document_type}</span>);
  }
  if (e.amount) {
    chips.push(<span key="amt" className="metachip">{e.amount}</span>);
  }
  if (e.event_starts_at) {
    chips.push(<span key="evt" className="metachip">{new Date(e.event_starts_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>);
  }
  return chips;
}

export function EmailRow({
  e,
  range,
  tz,
  actions,
  rating,
  showBucketDot,
  collapsible,
  selected,
  extraClass,
}: {
  e: EmailItem;
  range: RangeId;
  tz?: string;
  actions: RowActions;
  rating?: number | null;
  showBucketDot?: boolean;
  collapsible?: boolean;
  selected?: boolean;
  extraClass?: string;
}) {
  const display = senderDisplay(e.from_address);
  const cls = `erow${e.is_read ? ' read' : ''}${selected ? ' selected' : ''}${extraClass ? ` ${extraClass}` : ''}`;

  if (collapsible && e.collapsed) {
    return (
      <SwipeRow onArchive={() => actions.archive(e)}>
        <button
          className={`${cls} mini`}
          style={{ ['--bc' as string]: `var(--c-${e.bucket})` }}
          onClick={() => actions.setCollapsed?.(e, false)}
          title="Expand"
        >
          <span className="unread-dot" aria-hidden="true" />
          {showBucketDot && <span className="bucket-dot" title={BUCKET_META[e.bucket].name} />}
          <span className="mini-from">{display.name}</span>
          <span className="mini-subj">{e.subject || '(no subject)'}</span>
          <span className="time">{rowTime(e.processed_at, range, tz)}</span>
          <span className="chev">{Icon.chevronDown()}</span>
        </button>
      </SwipeRow>
    );
  }

  return (
    <SwipeRow onArchive={() => actions.archive(e)}>
      <button
        className={cls}
        style={{ ['--bc' as string]: `var(--c-${e.bucket})` }}
        onClick={() => actions.open(e)}
      >
        <span className="unread-dot" aria-hidden="true" />
        <span className="avatar">{initials(display.name)}</span>
        <span className="body">
          <span className="l1">
            {showBucketDot && <span className="bucket-dot" title={BUCKET_META[e.bucket].name} />}
            <span className="from">{display.name}</span>
            <span className="time">{rowTime(e.processed_at, range, tz)}</span>
          </span>
          <span className="subj">{e.subject || '(no subject)'}</span>
          {e.summary && <span className="sum">{e.summary}</span>}
          <span className="meta">{metaChips(e, rating)}</span>
        </span>
      </button>
      <RowTools e={e} actions={actions} collapsible={collapsible} />
    </SwipeRow>
  );
}
