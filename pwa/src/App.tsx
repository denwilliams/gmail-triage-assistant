import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bucket, EmailItem, EmailsResponse, RangeId } from './types';
import { BUCKETS } from './types';
import { api, AuthError, gmailLink } from './api';
import { BUCKET_META } from './lib';
import { Icon } from './icons';
import { HighlightsFeed } from './feed';
import { BucketView } from './buckets';
import { DetailView } from './detail';
import { RangePicker, rangeSpan, rangeTitle } from './range';
import type { RowActions } from './rows';

// ---------------------------------------------------------------------------
// Hash routing: #/ (home) · #/b/<bucket> (bucket list) · #/e/<id> (detail).
// Detail is hash-driven on mobile so the platform back button closes it.
// ---------------------------------------------------------------------------

type ListRoute = { view: 'home' } | { view: 'bucket'; bucket: Bucket };

function parseHash(): { list: ListRoute | null; detailId: string | null } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [kind, arg] = h.split('/');
  if (kind === 'b' && BUCKETS.includes(arg as Bucket)) {
    return { list: { view: 'bucket', bucket: arg as Bucket }, detailId: null };
  }
  if (kind === 'e' && arg) {
    return { list: null, detailId: arg };
  }
  return { list: { view: 'home' }, detailId: null };
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const fn = () => setDesktop(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return desktop;
}

interface Toast {
  msg: string;
  undo?: () => void;
}

export default function App() {
  const isDesktop = useIsDesktop();

  const [authState, setAuthState] = useState<'checking' | 'in' | 'out'>('checking');
  const [me, setMe] = useState<{ email: string } | null>(null);

  const [range, setRange] = useState<RangeId>('day');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [data, setData] = useState<EmailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [listRoute, setListRoute] = useState<ListRoute>({ view: 'home' });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toastState, setToastState] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string, undo?: () => void) => {
    setToastState({ msg, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), 3500);
  }, []);

  // ----- auth -----
  useEffect(() => {
    api.me().then(
      (m) => {
        setMe(m);
        setAuthState('in');
      },
      (err: unknown) => setAuthState(err instanceof AuthError ? 'out' : 'out'),
    );
  }, []);

  // ----- routing -----
  useEffect(() => {
    const apply = () => {
      const { list, detailId: d } = parseHash();
      if (list) {
        setListRoute(list);
        setDetailId(null);
      } else if (d) {
        setDetailId(d);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  const listHash = listRoute.view === 'home' ? '#/' : `#/b/${listRoute.bucket}`;

  // ----- data -----
  const load = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setLoadError(null);
      return api.emails(range, anchor).then(
        (res) => {
          setData(res);
          setLoading(false);
        },
        (err: unknown) => {
          if (err instanceof AuthError) {
            setAuthState('out');
            return;
          }
          setLoading(false);
          setLoadError(err instanceof Error ? err.message : 'Failed to load');
        },
      );
    },
    [range, anchor],
  );

  useEffect(() => {
    if (authState !== 'in') return;
    void load();
  }, [authState, load]);

  // Refresh silently when the app regains focus (PWA resume).
  useEffect(() => {
    if (authState !== 'in') return;
    const fn = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, [authState, load]);

  // ----- local mutations -----
  const patchEmail = useCallback((id: string, patch: Partial<EmailItem>) => {
    setData((d) =>
      d ? { ...d, emails: d.emails.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : d,
    );
  }, []);

  const selectedEmail = useMemo(
    () => data?.emails.find((e) => e.id === detailId) ?? null,
    [data, detailId],
  );

  const openEmail = useCallback(
    (e: EmailItem) => {
      if (!e.is_read) {
        patchEmail(e.id, { is_read: true });
        api.setRead(e.id, true).catch(() => patchEmail(e.id, { is_read: false }));
      }
      if (isDesktop) {
        setDetailId(e.id);
      } else {
        window.location.hash = `/e/${e.id}`;
      }
    },
    [isDesktop, patchEmail],
  );

  const closeDetail = useCallback(() => {
    if (isDesktop) {
      setDetailId(null);
    } else {
      window.location.hash = listHash.slice(1);
    }
  }, [isDesktop, listHash]);

  const archiveEmail = useCallback(
    (e: EmailItem) => {
      const stamp = new Date().toISOString();
      patchEmail(e.id, { archived_at: stamp, is_read: true });
      if (detailId === e.id) closeDetail();
      api.archive(e.id).catch(() => {
        patchEmail(e.id, { archived_at: null });
        toast('Archive failed');
      });
      toast('Archived', () => {
        patchEmail(e.id, { archived_at: null });
        api.unarchive(e.id).catch(() => toast('Undo failed'));
      });
    },
    [patchEmail, detailId, closeDetail, toast],
  );

  const trashEmail = useCallback(
    (e: EmailItem) => {
      patchEmail(e.id, { archived_at: new Date().toISOString(), is_read: true });
      if (detailId === e.id) closeDetail();
      api.trash(e.id).then(
        () => toast('Moved to Trash'),
        () => {
          patchEmail(e.id, { archived_at: null });
          toast('Trash failed');
        },
      );
    },
    [patchEmail, detailId, closeDetail, toast],
  );

  const moveEmail = useCallback(
    (e: EmailItem, bucket: Bucket) => {
      const prev = e.bucket;
      patchEmail(e.id, { bucket });
      api.setBucket(e.id, bucket).then(
        () => toast(`Moved to ${BUCKET_META[bucket].name}`),
        () => {
          patchEmail(e.id, { bucket: prev });
          toast('Move failed');
        },
      );
    },
    [patchEmail, toast],
  );

  const setCollapsed = useCallback(
    (e: EmailItem, collapsed: boolean) => {
      patchEmail(e.id, { collapsed });
      api.setCollapsed(e.id, collapsed).catch(() => patchEmail(e.id, { collapsed: !collapsed }));
    },
    [patchEmail],
  );

  const rowActions: RowActions = useMemo(
    () => ({
      open: openEmail,
      archive: archiveEmail,
      openGmail: (e) => window.open(gmailLink(e), '_blank', 'noopener'),
      setCollapsed,
    }),
    [openEmail, archiveEmail, setCollapsed],
  );

  const openBucket = useCallback((b: Bucket) => {
    window.location.hash = `/b/${b}`;
  }, []);

  // ----- range navigation -----
  const navigable = range === 'day' || range === 'week' || range === 'month';
  const navPrev = () => {
    if (data?.prev_anchor) setAnchor(data.prev_anchor);
  };
  const navNext = () => {
    if (data?.next_anchor) setAnchor(data.next_anchor);
  };
  const nextDisabled = !navigable || !data || (data.anchor !== null && data.next_anchor !== null && data.next_anchor > data.today);
  const selectRange = (r: RangeId) => {
    setRange(r);
    setAnchor(null);
  };

  // ----- derived -----
  const liveEmails = useMemo(() => data?.emails.filter((e) => !e.archived_at) ?? [], [data]);
  const totals = liveEmails.length;
  const unread = liveEmails.filter((e) => !e.is_read).length;
  const title =
    listRoute.view === 'bucket' ? BUCKET_META[listRoute.bucket].name : rangeTitle(range, data);
  const sub = data
    ? `${rangeSpan(data)} · ${totals} emails · ${unread} unread${data.truncated ? ' · truncated' : ''}`
    : '…';

  // ----- screens -----
  if (authState === 'checking') {
    return (
      <div className="center-screen">
        <div className="logo">{Icon.inbox()}</div>
        <p>Loading…</p>
      </div>
    );
  }
  if (authState === 'out') {
    return (
      <div className="center-screen">
        <div className="logo">{Icon.inbox()}</div>
        <h1>Mail — Triage Assistant</h1>
        <p>Sign in with the Google account your triage assistant runs on.</p>
        <a className="abtn primary" href="/auth/login">Sign in with Google</a>
      </div>
    );
  }

  const listContent = loading && !data ? (
    <div className="empty-state">Loading…</div>
  ) : loadError ? (
    <div className="empty-state">
      {loadError} — <button style={{ textDecoration: 'underline' }} onClick={() => void load()}>retry</button>
    </div>
  ) : data ? (
    listRoute.view === 'home' ? (
      <HighlightsFeed data={data} actions={rowActions} openBucket={openBucket} selectedId={detailId} />
    ) : (
      <BucketView bucket={listRoute.bucket} data={data} actions={rowActions} selectedId={detailId} toast={toast} />
    )
  ) : null;

  const header = (
    <div className="m-head">
      <div className="datebar">
        <RangePicker title={title} range={range} onSelect={selectRange}>
          <p className="sub">{sub}</p>
        </RangePicker>
        <button className="iconbtn" onClick={navPrev} disabled={!navigable} aria-label="Previous period">
          {Icon.chevronLeft()}
        </button>
        <button className="iconbtn" onClick={navNext} disabled={nextDisabled} aria-label="Next period">
          {Icon.chevronRight()}
        </button>
        <button className="iconbtn" onClick={() => void load()} aria-label="Refresh">
          {Icon.refresh()}
        </button>
      </div>
    </div>
  );

  const chipRail = (
    <div className="chiprail">
      <button
        className="fchip"
        aria-pressed={listRoute.view === 'home'}
        onClick={() => (window.location.hash = '/')}
      >
        All <span className="n">{totals}</span>
      </button>
      {BUCKETS.map((b) => {
        const n = liveEmails.filter((e) => e.bucket === b).length;
        return (
          <button
            key={b}
            className="fchip"
            style={{ ['--bc' as string]: `var(--c-${b})` }}
            aria-pressed={listRoute.view === 'bucket' && listRoute.bucket === b}
            onClick={() => openBucket(b)}
          >
            <span className="bucket-dot" />
            {BUCKET_META[b].name} <span className="n">{n}</span>
          </button>
        );
      })}
    </div>
  );

  const detail = selectedEmail && (
    <DetailView
      email={selectedEmail}
      rating={data?.ratings[selectedEmail.from_address]?.rating}
      tz={data?.timezone}
      onArchive={archiveEmail}
      onTrash={trashEmail}
      onMove={moveEmail}
      toast={toast}
    />
  );

  return (
    <div className="shell">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--primary)', color: 'var(--primary-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {Icon.inbox()}
          </div>
          <div>
            <div className="t">Mail</div>
            <div className="s">Triage Assistant</div>
          </div>
        </div>
        <nav className="navlist">
          <a className={`nitem${listRoute.view === 'home' ? ' on' : ''}`} href="#/">
            {Icon.inbox()}
            {rangeTitle(range, data)}
            <span className={`n${unread ? ' unread' : ''}`}>{unread ? `${unread} · ` : ''}{totals}</span>
          </a>
          <div className="lbl">Buckets</div>
          {BUCKETS.map((b) => {
            const items = liveEmails.filter((e) => e.bucket === b);
            const u = items.filter((e) => !e.is_read).length;
            return (
              <a
                key={b}
                className={`nitem${listRoute.view === 'bucket' && listRoute.bucket === b ? ' on' : ''}`}
                style={{ ['--bc' as string]: `var(--c-${b})` }}
                href={`#/b/${b}`}
              >
                <span className="bucket-dot" />
                {BUCKET_META[b].name}
                <span className={`n${u ? ' unread' : ''}`}>{u ? `${u} · ` : ''}{items.length}</span>
              </a>
            );
          })}
          <div className="lbl">More</div>
          <a className="nitem" href="/digests">{Icon.digest()}Digests</a>
          <a className="nitem" href="/dashboard">{Icon.gauge()}Dashboard</a>
          <a className="nitem" href="/settings">{Icon.settings()}Settings</a>
        </nav>
        <div className="foot">
          <div className="av">{(me?.email ?? '?').slice(0, 1).toUpperCase()}</div>
          <div className="who">
            <span className="e">{me?.email}</span>
          </div>
        </div>
      </aside>

      {/* List pane (whole screen on mobile) */}
      <section className="listpane shell" style={{ position: 'relative' }}>
        {header}
        {chipRail}
        <div className="scroll">{listContent}</div>

        {/* Mobile tab bar */}
        <nav className="m-tabbar">
          <button className="on" onClick={() => (window.location.hash = '/')}>
            {Icon.inbox()}Today
          </button>
          <a href="/digests">{Icon.digest()}Digest</a>
          <a href="/dashboard">{Icon.gauge()}Dashboard</a>
          <a href="/settings">{Icon.settings()}Settings</a>
        </nav>

        {/* Mobile slide-over detail */}
        <div className={`m-detail${selectedEmail && !isDesktop ? ' open' : ''}`} role="dialog" aria-label="Email">
          <div className="d-top">
            <button className="iconbtn" onClick={closeDetail} aria-label="Back">
              {Icon.chevronLeft()}
            </button>
            <div className="grow" />
          </div>
          {!isDesktop && detail}
        </div>

        <div className="toastwrap">
          {toastState && (
            <div className="toast">
              {toastState.msg}
              {toastState.undo && (
                <button
                  onClick={() => {
                    toastState.undo?.();
                    setToastState(null);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Desktop reading pane */}
      <section className="readpane">
        {isDesktop && selectedEmail ? (
          detail
        ) : (
          <div className="rp-empty">
            <div className="big">{Icon.mail()}</div>
            <p>Select an email to read it here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
