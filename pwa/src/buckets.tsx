import type { Bucket, EmailItem, EmailsResponse } from './types';
import {
  BUCKET_META,
  amountValue,
  extractOtpCode,
  formatMoney,
  initials,
  rowTime,
  senderDisplay,
  sortNotifications,
} from './lib';
import { Icon } from './icons';
import { EmailRow, RowTools, SwipeRow, type RowActions } from './rows';

interface ViewProps {
  data: EmailsResponse;
  emails: EmailItem[];
  actions: RowActions;
  selectedId: string | null;
  toast: (msg: string) => void;
}

/** Compact sub-row used inside sender/vendor groups: subject-first, no avatar. */
function SubRow({
  e,
  data,
  actions,
  selected,
  meta,
}: {
  e: EmailItem;
  data: EmailsResponse;
  actions: RowActions;
  selected: boolean;
  meta?: React.ReactNode;
}) {
  return (
    <SwipeRow onArchive={() => actions.archive(e)}>
      <button
        className={`erow sub${e.is_read ? ' read' : ''}${selected ? ' selected' : ''}`}
        style={{ ['--bc' as string]: `var(--c-${e.bucket})` }}
        onClick={() => actions.open(e)}
      >
        <span className="unread-dot" aria-hidden="true" />
        <span className="body">
          <span className="l1">
            <span className="subj" style={{ flex: 1 }}>{e.subject || '(no subject)'}</span>
            {meta}
            <span className="time">{rowTime(e.processed_at, data.range, data.timezone)}</span>
          </span>
          {e.summary && <span className="sum">{e.summary}</span>}
        </span>
      </button>
      <RowTools e={e} actions={actions} />
    </SwipeRow>
  );
}

function HumanView({ data, emails, actions, selectedId }: ViewProps) {
  const order: string[] = [];
  const groups = new Map<string, EmailItem[]>();
  for (const e of emails) {
    if (!groups.has(e.from_address)) {
      groups.set(e.from_address, []);
      order.push(e.from_address);
    }
    groups.get(e.from_address)!.push(e);
  }
  return (
    <>
      {order.map((addr) => {
        const g = groups.get(addr)!;
        const display = senderDisplay(addr);
        const rating = data.ratings[addr]?.rating;
        return (
          <div key={addr}>
            <div className="sgroup-head" style={{ ['--bc' as string]: 'var(--c-human)' }}>
              <span className="avatar">{initials(display.name)}</span>
              <span className="who">
                <span className="nm">{display.name}</span>
                <span className="em">{display.email}</span>
              </span>
              {rating !== undefined && rating !== null && (
                <span className="metachip">rating {rating}</span>
              )}
            </div>
            <div className="feed">
              {g.map((e) => (
                <SubRow key={e.id} e={e} data={data} actions={actions} selected={selectedId === e.id} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function CalendarView({ data, emails, actions }: ViewProps) {
  const items = [...emails].sort((a, b) =>
    (a.event_starts_at ?? 'z').localeCompare(b.event_starts_at ?? 'z'),
  );
  return (
    <div className="feed">
      {items.map((e) => {
        const start = e.event_starts_at ? new Date(e.event_starts_at) : null;
        const timeParts = start
          ? new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: data.timezone,
            }).formatToParts(start)
          : null;
        const hm = timeParts
          ? timeParts.filter((p) => ['hour', 'minute', 'literal'].includes(p.type) && p.value !== ' ')
              .map((p) => p.value).join('').trim()
          : '—';
        const ap = timeParts?.find((p) => p.type === 'dayPeriod')?.value ?? '';
        const dateLbl = start && data.range !== 'day'
          ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: data.timezone })
          : null;
        return (
          <SwipeRow key={e.id} onArchive={() => actions.archive(e)}>
            <button className="cal-item" onClick={() => actions.open(e)}>
              <span className="cal-time">
                <span className="h">{hm}</span>
                <span className="ap">{ap}{dateLbl ? ` · ${dateLbl}` : ''}</span>
              </span>
              <span className="cal-rail" />
              <span className="cal-body">
                <span className="t">{e.event_title || e.subject}</span>
                {e.event_location && (
                  <span className="loc">
                    {Icon.pin()}
                    {e.event_location}
                  </span>
                )}
                <span className="via">
                  via {senderDisplay(e.from_address).name} · {rowTime(e.processed_at, data.range, data.timezone)}
                </span>
              </span>
            </button>
            <RowTools e={e} actions={actions} />
          </SwipeRow>
        );
      })}
    </div>
  );
}

function SecurityView(props: ViewProps) {
  const { data, emails, actions, selectedId, toast } = props;
  const actionsNeeded = emails.filter((e) => !e.is_otp);
  const otps = emails.filter((e) => e.is_otp);
  return (
    <>
      {actionsNeeded.length > 0 && (
        <>
          <div className="sect-lbl">Needs action</div>
          <div className="feed">
            {actionsNeeded.map((e) => (
              <EmailRow
                key={e.id}
                e={e}
                range={data.range}
                tz={data.timezone}
                actions={actions}
                selected={selectedId === e.id}
              />
            ))}
          </div>
        </>
      )}
      {otps.length > 0 && (
        <>
          <div className="sect-lbl">One-time codes</div>
          {otps.map((e) => {
            const code = extractOtpCode(e);
            return (
              <div key={e.id} className="otp-card">
                <span className="otp-code">{code ?? '······'}</span>
                <span className="otp-meta">
                  <span className="f">{senderDisplay(e.from_address).name}</span>
                  <span className="x">{rowTime(e.processed_at, data.range, data.timezone)}</span>
                </span>
                {code && (
                  <button
                    className="abtn"
                    onClick={() => {
                      navigator.clipboard?.writeText(code).then(
                        () => toast(`Code ${code} copied`),
                        () => toast('Copy failed'),
                      );
                    }}
                  >
                    Copy
                  </button>
                )}
                <button className="abtn iconly" onClick={() => actions.open(e)} title="Open email">
                  {Icon.mail()}
                </button>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function NotificationView({ data, emails, actions, selectedId }: ViewProps) {
  const sorted = sortNotifications(emails);
  const important = sorted.filter((e) => e.severity === 'high' || e.severity === 'critical');
  const routine = sorted.filter((e) => !(e.severity === 'high' || e.severity === 'critical'));
  const section = (label: string, color: string, items: EmailItem[], stripe: string) =>
    items.length > 0 && (
      <>
        <div className="sect-lbl">
          <span className="sev-dot" style={{ background: color }} />
          {label}
        </div>
        <div className="feed">
          {items.map((e) => (
            <EmailRow
              key={e.id}
              e={e}
              range={data.range}
              tz={data.timezone}
              actions={actions}
              selected={selectedId === e.id}
              extraClass={stripe}
            />
          ))}
        </div>
      </>
    );
  return (
    <>
      {section('Important', 'var(--c-security)', important, 'stripe-high')}
      {section('Routine', 'var(--ink-3)', routine, 'stripe-low')}
    </>
  );
}

function TransactionalView({ data, emails, actions, selectedId }: ViewProps) {
  const order: string[] = [];
  const groups = new Map<string, EmailItem[]>();
  let total = 0;
  for (const e of emails) {
    const vendor = (e.vendor && e.vendor.trim()) || senderDisplay(e.from_address).name;
    if (!groups.has(vendor)) {
      groups.set(vendor, []);
      order.push(vendor);
    }
    groups.get(vendor)!.push(e);
    total += amountValue(e.amount);
  }
  return (
    <>
      <div className="tx-summary">
        <span className="amt">{formatMoney(total)}</span>
        <span className="lbl2">across {order.length} vendor{order.length === 1 ? '' : 's'}</span>
      </div>
      {order.map((vendor) => {
        const g = groups.get(vendor)!;
        const vt = g.reduce((s, e) => s + amountValue(e.amount), 0);
        return (
          <div key={vendor}>
            <div className="vgroup-head">
              <span className="v">{vendor}</span>
              <span className="vt">{formatMoney(vt)}</span>
            </div>
            <div className="feed">
              {g.map((e) => (
                <SubRow
                  key={e.id}
                  e={e}
                  data={data}
                  actions={actions}
                  selected={selectedId === e.id}
                  meta={
                    <>
                      {e.document_type && <span className="metachip">{e.document_type}</span>}
                      {e.amount && <span className="tx-amt">{e.amount}</span>}
                    </>
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function NewsletterView({ data, emails, actions, selectedId }: ViewProps) {
  const ranked = [...emails].sort((a, b) => (b.interesting_score ?? 0) - (a.interesting_score ?? 0));
  const good = ranked.filter((e) => (e.interesting_score ?? 0) >= 5);
  const low = ranked.filter((e) => (e.interesting_score ?? 0) < 5);
  return (
    <>
      {good.length > 0 && (
        <div className="feed">
          {good.map((e) => {
            const display = senderDisplay(e.from_address);
            return (
              <SwipeRow key={e.id} onArchive={() => actions.archive(e)}>
                <button
                  className={`erow${e.is_read ? ' read' : ''}${selectedId === e.id ? ' selected' : ''}`}
                  style={{ ['--bc' as string]: 'var(--c-newsletter)' }}
                  onClick={() => actions.open(e)}
                >
                  <span className="unread-dot" aria-hidden="true" />
                  <span className="avatar">{initials(display.name)}</span>
                  <span className="body">
                    <span className="l1">
                      <span className="from">{display.name}</span>
                      <span className="nl-score">
                        <span className="scorebar"><i style={{ width: `${(e.interesting_score ?? 0) * 10}%` }} /></span>
                        <span className="sc">{e.interesting_score ?? 0}/10</span>
                      </span>
                      <span className="time">{rowTime(e.processed_at, data.range, data.timezone)}</span>
                    </span>
                    <span className="subj">{e.subject || '(no subject)'}</span>
                    {e.summary && <span className="sum">{e.summary}</span>}
                    {e.interesting_reasons[0] && (
                      <span className="nl-reason">{Icon.newsletter()}{e.interesting_reasons[0]}</span>
                    )}
                  </span>
                </button>
                <RowTools e={e} actions={actions} />
              </SwipeRow>
            );
          })}
        </div>
      )}
      {low.length > 0 && (
        <>
          <div className="sect-lbl">Low interest</div>
          <div className="feed">
            {low.map((e) => {
              const display = senderDisplay(e.from_address);
              return (
                <SwipeRow key={e.id} onArchive={() => actions.archive(e)}>
                  <button
                    className="erow mini read"
                    style={{ ['--bc' as string]: 'var(--c-newsletter)' }}
                    onClick={() => actions.open(e)}
                  >
                    <span className="mini-from">{display.name}</span>
                    <span className="mini-subj">{e.subject || '(no subject)'}</span>
                    <span className="sc" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                      {e.interesting_score ?? 0}/10
                    </span>
                    <span className="time">{rowTime(e.processed_at, data.range, data.timezone)}</span>
                  </button>
                </SwipeRow>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export function BucketView({
  bucket,
  data,
  actions,
  selectedId,
  toast,
}: {
  bucket: Bucket;
  data: EmailsResponse;
  actions: RowActions;
  selectedId: string | null;
  toast: (msg: string) => void;
}) {
  const emails = data.emails.filter((e) => e.bucket === bucket);
  if (!emails.length) {
    return <div className="empty-state">Nothing in {BUCKET_META[bucket].name.toLowerCase()} for this period.</div>;
  }
  const props: ViewProps = { data, emails, actions, selectedId, toast };
  const view = {
    human: <HumanView {...props} />,
    calendar: <CalendarView {...props} />,
    security: <SecurityView {...props} />,
    notification: <NotificationView {...props} />,
    transactional: <TransactionalView {...props} />,
    newsletter: <NewsletterView {...props} />,
  }[bucket];
  return (
    <>
      <div className="bucket-desc">
        {BUCKET_META[bucket].desc} · {emails.length} in this period
      </div>
      {view}
    </>
  );
}
