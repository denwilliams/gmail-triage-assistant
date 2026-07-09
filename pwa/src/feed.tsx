import type { Bucket, EmailItem, EmailsResponse } from './types';
import { BUCKETS } from './types';
import { BUCKET_META, needsAttention, senderDisplay } from './lib';
import { BUCKET_ICONS, Icon } from './icons';
import { EmailRow, type RowActions } from './rows';

const HL_HUMANS_SHOWN = 4;

/** One-line "who it's from" summary for a collapsed bucket row. */
function summaryLine(bucket: Bucket, emails: EmailItem[]): string {
  const parts = emails.slice(0, 3).map((e) => {
    if (bucket === 'transactional') {
      const vendor = e.vendor || senderDisplay(e.from_address).name;
      return e.amount ? `${vendor} ${e.amount}` : vendor;
    }
    const name = senderDisplay(e.from_address).name;
    if (bucket === 'newsletter' && (e.interesting_score ?? 0) >= 7) {
      return `${name} (${e.interesting_score}/10)`;
    }
    return name;
  });
  const extra = emails.length - parts.length;
  return parts.join(' · ') + (extra > 0 ? ` · +${extra} more` : '');
}

export function HighlightsFeed({
  data,
  actions,
  openBucket,
  selectedId,
}: {
  data: EmailsResponse;
  actions: RowActions;
  openBucket: (b: Bucket) => void;
  selectedId: string | null;
}) {
  // The home feed hides archived emails — it's "what still needs me",
  // not history. Bucket views keep the full record.
  const live = data.emails.filter((e) => !e.archived_at);
  if (!live.length) {
    return <div className="empty-state">Nothing here — all clear.</div>;
  }

  const humans = live.filter((e) => e.bucket === 'human');
  const shown = humans.slice(0, HL_HUMANS_SHOWN);
  const attention = live.filter((e) => e.bucket !== 'human' && needsAttention(e));

  const restRows = BUCKETS.filter((b) => b !== 'human').map((b) => {
    const remaining = live.filter((e) => e.bucket === b && !needsAttention(e));
    if (!remaining.length) return null;
    const unread = remaining.filter((e) => !e.is_read).length;
    return (
      <button
        key={b}
        className="brow"
        style={{ ['--bc' as string]: `var(--c-${b})` }}
        onClick={() => openBucket(b)}
      >
        <span className="icon">{BUCKET_ICONS[b]()}</span>
        <span className="who">
          <span className="t">
            {BUCKET_META[b].name}
            <span className="n">
              {remaining.length}
              {unread ? ` · ${unread} new` : ''}
            </span>
          </span>
          <span className="senders">{summaryLine(b, remaining)}</span>
        </span>
        <span className="chev">{Icon.chevronRight()}</span>
      </button>
    );
  }).filter(Boolean);

  return (
    <>
      <div className="feed">
        {shown.map((e) => (
          <EmailRow
            key={e.id}
            e={e}
            range={data.range}
            tz={data.timezone}
            actions={actions}
            rating={data.ratings[e.from_address]?.rating}
            showBucketDot
            collapsible
            selected={selectedId === e.id}
          />
        ))}
        {humans.length > shown.length && (
          <button className="hl-see" onClick={() => openBucket('human')}>
            See all {humans.length} from humans {Icon.chevronRight()}
          </button>
        )}
        {attention.map((e) => (
          <EmailRow
            key={e.id}
            e={e}
            range={data.range}
            tz={data.timezone}
            actions={actions}
            showBucketDot
            collapsible
            selected={selectedId === e.id}
          />
        ))}
      </div>
      {restRows.length > 0 && (
        <>
          <div className="sect-lbl">Everything else</div>
          <div className="browstack">{restRows}</div>
        </>
      )}
    </>
  );
}
