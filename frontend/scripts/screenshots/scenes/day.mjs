// Scenes for the /day page. Mocks the /days/:date endpoint with a synthetic
// day that exercises every bucket renderer — humans grouped by sender,
// newsletters ordered by score, etc.

import { registerHandler } from "../mock-api.mjs";

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const isoIn = (m) => new Date(Date.now() + m * 60_000).toISOString();

// Tiny helper for building DayEmail rows in fixtures.
const e = (overrides) => ({
  id: overrides.id,
  from_address: overrides.from_address,
  subject: overrides.subject,
  summary: overrides.summary ?? "",
  processed_at: overrides.processed_at ?? minutesAgo(60),
  thread_id: null,
  interesting_score: null,
  interesting_reasons: [],
  severity: null,
  urgency: null,
  vendor: null,
  document_type: null,
  amount: null,
  action_type: null,
  is_otp: null,
  event_title: null,
  event_starts_at: null,
  event_ends_at: null,
  event_location: null,
  bypassed_inbox: false,
  ...overrides,
});

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const dayView = {
  date: today,
  today,
  timezone: "Australia/Sydney",
  prev_date: yesterday,
  next_date: tomorrow,
  total: 13,
  bucket_totals: {
    human: 4,
    newsletter: 3,
    notification: 2,
    security: 2,
    transactional: 1,
    calendar: 1,
  },
  sections: {
    human: {
      groups: [
        {
          from_address: '"Alex Park" <alex.park@example.test>',
          rating: 82,
          rating_manual: false,
          emails: [
            e({
              id: "h1a",
              from_address: '"Alex Park" <alex.park@example.test>',
              subject: "Re: lunch on Thursday",
              summary: "Confirms 12:30 at the usual place, asks if you want to invite Sam.",
              processed_at: minutesAgo(45),
            }),
            e({
              id: "h1b",
              from_address: '"Alex Park" <alex.park@example.test>',
              subject: "Photos from the weekend",
              summary: "Shared an album from the hike — 24 photos, mostly the view from the top.",
              processed_at: minutesAgo(180),
            }),
          ],
        },
        {
          from_address: '"Sam Rivera" <sam@example.test>',
          rating: 64,
          rating_manual: true,
          emails: [
            e({
              id: "h2a",
              from_address: '"Sam Rivera" <sam@example.test>',
              subject: "Quick question about the proposal",
              summary: "Wants clarification on section 3 before forwarding to the client.",
              processed_at: minutesAgo(95),
            }),
          ],
        },
        {
          from_address: "old.contact@example.test",
          rating: 22,
          rating_manual: false,
          emails: [
            e({
              id: "h3a",
              from_address: "old.contact@example.test",
              subject: "checking in",
              summary: "Long-form check-in, no specific ask.",
              processed_at: minutesAgo(300),
              bypassed_inbox: true,
            }),
          ],
        },
      ],
    },
    newsletter: {
      emails: [
        e({
          id: "nl1",
          from_address: '"Stratechery Daily" <daily@strate-demo.test>',
          subject: "The platform shift nobody is talking about",
          summary: "Argues that the next platform shift is happening at the protocol layer, not the app layer.",
          processed_at: minutesAgo(120),
          interesting_score: 9,
          interesting_reasons: ["Mentions a topic you follow"],
          bypassed_inbox: true,
        }),
        e({
          id: "nl2",
          from_address: "weekly@news-demo.test",
          subject: "This week in fictional news",
          summary: "Roundup of the week's stories — three deep dives and a reading list.",
          processed_at: minutesAgo(200),
          interesting_score: 6,
          interesting_reasons: ["Long-form analysis"],
          bypassed_inbox: true,
        }),
        e({
          id: "nl3",
          from_address: "deals@shopdemo.test",
          subject: "Picks we think you'll like",
          summary: "Promotional roundup with five product picks.",
          processed_at: minutesAgo(240),
          interesting_score: 2,
          interesting_reasons: [],
          bypassed_inbox: true,
        }),
      ],
    },
    notification: {
      emails: [
        e({
          id: "n1",
          from_address: "monitoring@infra-demo.test",
          subject: "CRITICAL: payments-api error rate above threshold",
          summary: "Error rate at 12% for 5 minutes — runbook attached.",
          processed_at: minutesAgo(15),
          severity: "critical",
          urgency: "high",
        }),
        e({
          id: "n2",
          from_address: "alerts@socialnet.test",
          subject: "You have 7 new connection requests",
          summary: "Weekly batch of pending connection requests.",
          processed_at: minutesAgo(190),
          severity: "low",
          urgency: "low",
          bypassed_inbox: true,
        }),
      ],
    },
    security: {
      emails: [
        e({
          id: "s1",
          from_address: "security@accounts-demo.test",
          subject: "New sign-in from Sydney, AU",
          summary: "Sign-in from a new device. If this wasn't you, secure your account.",
          processed_at: minutesAgo(30),
          action_type: "login_alert",
          is_otp: false,
        }),
        e({
          id: "s2",
          from_address: "no-reply@auth-demo.test",
          subject: "Your verification code is 729183",
          summary: "One-time code, expires in 10 minutes.",
          processed_at: minutesAgo(35),
          action_type: "mfa",
          is_otp: true,
        }),
      ],
    },
    transactional: {
      groups: [
        {
          vendor: "Coffee Demo Co",
          emails: [
            e({
              id: "t1",
              from_address: "receipts@coffeedemo.test",
              subject: "Receipt for order #4421",
              summary: "Two flat whites, one croissant.",
              processed_at: minutesAgo(220),
              vendor: "Coffee Demo Co",
              document_type: "receipt",
              amount: "AUD 12.40",
              bypassed_inbox: true,
            }),
          ],
        },
      ],
    },
    calendar: {
      emails: [
        e({
          id: "c1",
          from_address: "no-reply@cal-demo.test",
          subject: "Invitation: Demo sync",
          summary: "Weekly demo sync — agenda in the description.",
          processed_at: minutesAgo(260),
          event_title: "Demo sync",
          event_starts_at: isoIn(60 * 4),
          event_ends_at: isoIn(60 * 4 + 30),
          event_location: "Online · Demo Meet",
        }),
      ],
    },
  },
};

// Mock the day endpoint for any date — the screenshot tool always hits the
// no-date variant, but cover both.
registerHandler("/days", () => dayView);
registerHandler(`/days/${today}`, () => dayView);
registerHandler(`/days/${yesterday}`, () => ({ ...dayView, date: yesterday }));

export default [
  {
    // 3-column desktop layout (xl breakpoint, ≥1280px).
    name: "day-3col",
    path: "/day",
    viewport: { width: 1600, height: 1100 },
  },
  {
    // 2-column tablet layout (md breakpoint, ≥768px and <1280px).
    name: "day-2col",
    path: "/day",
    viewport: { width: 1100, height: 1400 },
  },
  {
    // 1-column mobile layout (<768px). Sections heavily cropped with
    // expand buttons.
    name: "day-1col",
    path: "/day",
    viewport: { width: 480, height: 1400 },
  },
];
