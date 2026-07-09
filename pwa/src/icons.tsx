import type { Bucket } from './types';

function I({ d, className }: { d: React.ReactNode; className?: string }) {
  return (
    <svg className={`i ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {d}
    </svg>
  );
}

export const Icon = {
  inbox: (c?: string) => (
    <I className={c} d={<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>} />
  ),
  human: (c?: string) => (
    <I className={c} d={<><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>} />
  ),
  calendar: (c?: string) => (
    <I className={c} d={<><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></>} />
  ),
  security: (c?: string) => (
    <I className={c} d={<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>} />
  ),
  transactional: (c?: string) => (
    <I className={c} d={<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></>} />
  ),
  newsletter: (c?: string) => (
    <I className={c} d={<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />} />
  ),
  chevronLeft: (c?: string) => <I className={c} d={<path d="m15 18-6-6 6-6" />} />,
  chevronRight: (c?: string) => <I className={c} d={<path d="m9 18 6-6-6-6" />} />,
  chevronDown: (c?: string) => <I className={c} d={<path d="m6 9 6 6 6-6" />} />,
  collapse: (c?: string) => <I className={c} d={<><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></>} />,
  archive: (c?: string) => (
    <I className={c} d={<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>} />
  ),
  trash: (c?: string) => (
    <I className={c} d={<><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>} />
  ),
  reply: (c?: string) => (
    <I className={c} d={<><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>} />
  ),
  send: (c?: string) => (
    <I className={c} d={<><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></>} />
  ),
  external: (c?: string) => (
    <I className={c} d={<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>} />
  ),
  folder: (c?: string) => (
    <I className={c} d={<path d="M22 20V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z" />} />
  ),
  pin: (c?: string) => (
    <I className={c} d={<><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>} />
  ),
  check: (c?: string) => <I className={c} d={<path d="M20 6 9 17l-5-5" />} />,
  refresh: (c?: string) => (
    <I className={c} d={<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></>} />
  ),
  digest: (c?: string) => (
    <I className={c} d={<><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0V7" /><path d="M12 6h6" /><path d="M12 10h6" /><path d="M12 14h6" /></>} />
  ),
  settings: (c?: string) => (
    <I className={c} d={<><line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" /></>} />
  ),
  gauge: (c?: string) => (
    <I className={c} d={<><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>} />
  ),
  mail: (c?: string) => (
    <I className={c} d={<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>} />
  ),
};

export const BUCKET_ICONS: Record<Bucket, (c?: string) => React.ReactNode> = {
  human: Icon.human,
  calendar: Icon.calendar,
  security: Icon.security,
  notification: Icon.inbox,
  transactional: Icon.transactional,
  newsletter: Icon.newsletter,
};
