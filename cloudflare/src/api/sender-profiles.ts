import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Bucket, BucketConsistency, SenderProfile, ProfileType } from '../types/models';
import { BUCKETS } from '../types/models';
import type { SenderProfileSort } from '../db/sender-profiles';
import {
  getSenderProfile,
  getSenderProfileByID,
  getAllSenderProfiles,
  upsertSenderProfile,
  extractDomain,
  isIgnoredDomain,
  buildProfileFromEmails,
} from '../db/sender-profiles';

const SORTS: SenderProfileSort[] = [
  'volume',
  'recent',
  'rating_high',
  'rating_low',
  'consistency',
];
const CONSISTENCIES: BucketConsistency[] = ['unknown', 'consistent', 'mixed'];
import {
  getHistoricalEmailsFromAddress,
  getHistoricalEmailsFromDomain,
} from '../db/emails';
import type { OpenAIConfig } from '../services/openai';
import { bootstrapSenderProfile } from '../services/openai';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function profileToJSON(p: SenderProfile) {
  return {
    id: p.id,
    user_id: p.userId,
    profile_type: p.profileType,
    identifier: p.identifier,
    email_count: p.emailCount,
    emails_archived: p.emailsArchived,
    emails_notified: p.emailsNotified,
    slug_counts: p.slugCounts,
    label_counts: p.labelCounts,
    keyword_counts: p.keywordCounts,
    sender_type: p.senderType,
    summary: p.summary,
    first_seen_at: p.firstSeenAt,
    last_seen_at: p.lastSeenAt,
    rating: p.rating,
    rating_reasoning: p.ratingReasoning,
    rating_manual: p.ratingManual,
    rating_updated_at: p.ratingUpdatedAt,
    bucket_consistency: p.bucketConsistency,
    primary_bucket: p.primaryBucket,
    bucket_counts: p.bucketCounts,
  };
}

export async function handleGetAllSenderProfiles(c: AppContext) {
  const userId = c.get('userId');
  const profileType = c.req.query('type') || null;
  const search = c.req.query('search') || null;

  let limit = 50;
  const limitParam = c.req.query('limit');
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  let offset = 0;
  const offsetParam = c.req.query('offset');
  if (offsetParam) {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) offset = parsed;
  }

  let sort: SenderProfileSort = 'volume';
  const sortParam = c.req.query('sort');
  if (sortParam) {
    if (!SORTS.includes(sortParam as SenderProfileSort)) {
      return c.json({ error: 'Invalid sort' }, 400);
    }
    sort = sortParam as SenderProfileSort;
  }

  let consistency: BucketConsistency | undefined;
  const consistencyParam = c.req.query('consistency');
  if (consistencyParam) {
    if (!CONSISTENCIES.includes(consistencyParam as BucketConsistency)) {
      return c.json({ error: 'Invalid consistency' }, 400);
    }
    consistency = consistencyParam as BucketConsistency;
  }

  let bucket: Bucket | undefined;
  const bucketParam = c.req.query('bucket');
  if (bucketParam) {
    if (!BUCKETS.includes(bucketParam as Bucket)) {
      return c.json({ error: 'Invalid bucket' }, 400);
    }
    bucket = bucketParam as Bucket;
  }

  let ratingState: 'null' | 'manual' | 'auto' | undefined;
  const ratingStateParam = c.req.query('rating_state');
  if (ratingStateParam) {
    if (!['null', 'manual', 'auto'].includes(ratingStateParam)) {
      return c.json({ error: 'Invalid rating_state' }, 400);
    }
    ratingState = ratingStateParam as 'null' | 'manual' | 'auto';
  }

  try {
    const { profiles, total } = await getAllSenderProfiles(
      c.env.DB,
      userId,
      { profileType, search, sort, consistency, bucket, ratingState },
      limit,
      offset,
    );

    return c.json({
      profiles: profiles.map(profileToJSON),
      total,
    });
  } catch (e) {
    console.error('Failed to load all sender profiles:', e);
    return c.json({ error: 'Failed to load sender profiles' }, 500);
  }
}

export async function handleGetSenderProfiles(c: AppContext) {
  const userId = c.get('userId');
  const address = c.req.query('address');
  if (!address) {
    return c.json({ error: 'address query parameter is required' }, 400);
  }

  try {
    const senderProfile = await getSenderProfile(c.env.DB, userId, 'sender', address);

    let domainProfile: SenderProfile | null = null;
    const domain = extractDomain(address);
    if (domain && !isIgnoredDomain(domain)) {
      domainProfile = await getSenderProfile(c.env.DB, userId, 'domain', domain);
    }

    return c.json({
      sender: senderProfile ? profileToJSON(senderProfile) : null,
      domain: domainProfile ? profileToJSON(domainProfile) : null,
    });
  } catch (e) {
    console.error('Failed to load sender profiles:', e);
    return c.json({ error: 'Failed to load sender profiles' }, 500);
  }
}

export async function handleGenerateSenderProfile(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req
    .json<{ profile_type?: string; identifier?: string }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const profileType = body.profile_type as ProfileType;
  if (profileType !== 'sender' && profileType !== 'domain') {
    return c.json({ error: "profile_type must be 'sender' or 'domain'" }, 400);
  }
  if (!body.identifier) {
    return c.json({ error: 'identifier is required' }, 400);
  }

  try {
    // Fetch historical emails so we can refresh the AI summary from them.
    const emails =
      profileType === 'sender'
        ? await getHistoricalEmailsFromAddress(c.env.DB, userId, body.identifier, 25)
        : await getHistoricalEmailsFromDomain(c.env.DB, userId, body.identifier, 25);

    // Regenerate preserves the existing profile (rating, bucket
    // consistency, counts, manual overrides) and only refreshes the
    // AI-generated sender_type + summary. For first-time creation we
    // build a profile from history.
    const existing = await getSenderProfile(c.env.DB, userId, profileType, body.identifier);
    const profile = existing ?? buildProfileFromEmails(userId, profileType, body.identifier, emails);

    // If we have history, use AI to classify and summarize
    let aiError = '';
    if (emails.length > 0 && c.env.OPENAI_API_KEY) {
      try {
        const config: OpenAIConfig = {
          apiKey: c.env.OPENAI_API_KEY,
          model: c.env.OPENAI_MODEL || 'gpt-4o-mini',
          baseUrl: c.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        };
        // Build email summaries for the AI
        const emailSummaries = emails
          .map(
            (e) =>
              `Subject: ${e.subject}\nSlug: ${e.slug}\nLabels: ${e.labelsApplied.join(', ')}\nArchived: ${e.bypassedInbox}`,
          )
          .join('\n---\n');
        const result = await bootstrapSenderProfile(config, body.identifier, emailSummaries);
        profile.senderType = result.sender_type;
        profile.summary = result.summary;
      } catch (err) {
        console.error(`Error bootstrapping profile for ${body.identifier}:`, err);
        aiError = err instanceof Error ? err.message : 'Unknown AI error';
      }
    } else if (!c.env.OPENAI_API_KEY) {
      aiError = 'openai client not configured';
    } else {
      aiError = 'no historical emails found';
    }

    // Save the profile
    await upsertSenderProfile(c.env.DB, profile);

    // Re-fetch to get DB-assigned ID and timestamps
    const saved = await getSenderProfile(c.env.DB, userId, profileType, body.identifier);

    const response: Record<string, unknown> = {
      profile: saved ? profileToJSON(saved) : profileToJSON(profile),
    };
    if (aiError) {
      response.ai_error = aiError;
    }

    console.log(
      `Generated ${profileType} profile for ${body.identifier} (emails: ${emails.length}, ai_error: ${aiError})`,
    );

    return c.json(response);
  } catch (e) {
    console.error(`Failed to generate profile for ${body.identifier}:`, e);
    return c.json({ error: 'Failed to generate profile' }, 500);
  }
}

export async function handleUpdateSenderProfile(c: AppContext) {
  const userId = c.get('userId');
  const idParam = c.req.param('id') ?? '';
  const id = parseInt(idParam, 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid profile ID' }, 400);
  }

  const body = await c.req
    .json<{
      summary?: string;
      sender_type?: string;
      label_counts?: Record<string, number>;
      rating?: number | null;
      rating_reasoning?: string;
      rating_manual?: boolean;
    }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  try {
    const profile = await getSenderProfileByID(c.env.DB, userId, id);
    if (!profile) {
      return c.json({ error: 'Profile not found' }, 404);
    }

    if (body.summary !== undefined) {
      profile.summary = body.summary;
    }
    if (body.sender_type !== undefined) {
      profile.senderType = body.sender_type;
    }
    if (body.label_counts !== undefined) {
      profile.labelCounts = body.label_counts;
    }

    // Rating override: setting rating=null reverts to auto-learn.
    if (body.rating !== undefined) {
      if (body.rating === null) {
        profile.rating = null;
        profile.ratingReasoning = '';
        profile.ratingManual = false;
      } else {
        const v = Math.max(0, Math.min(99, Math.round(body.rating)));
        profile.rating = v;
        profile.ratingManual = body.rating_manual ?? true;
        if (body.rating_reasoning !== undefined) {
          profile.ratingReasoning = body.rating_reasoning;
        }
      }
      profile.ratingUpdatedAt = new Date().toISOString();
    }

    await upsertSenderProfile(c.env.DB, profile);
    return c.json(profileToJSON(profile));
  } catch (e) {
    console.error('Failed to update sender profile:', e);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
}

export async function handleRateSenderNow(c: AppContext) {
  const userId = c.get('userId');
  const idParam = c.req.param('id') ?? '';
  const id = parseInt(idParam, 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid profile ID' }, 400);
  }

  // Lazy import to avoid pulling ai.ts into the v1 code path.
  const { rateOneSender } = await import('../jobs/sender-rating');
  try {
    const profile = await rateOneSender(c.env, userId, id);
    if (!profile) return c.json({ error: 'Profile not found' }, 404);
    return c.json(profileToJSON(profile));
  } catch (e) {
    console.error('Failed to rate sender:', e);
    return c.json({ error: 'Failed to rate sender' }, 500);
  }
}
