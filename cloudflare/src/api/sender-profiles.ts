import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { SenderProfile, ProfileType } from '../types/models';
import {
  getSenderProfile,
  getSenderProfileByID,
  upsertSenderProfile,
  extractDomain,
  isIgnoredDomain,
  buildProfileFromEmails,
} from '../db/sender-profiles';
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
  };
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
    // Fetch historical emails
    const emails =
      profileType === 'sender'
        ? await getHistoricalEmailsFromAddress(c.env.DB, userId, body.identifier, 25)
        : await getHistoricalEmailsFromDomain(c.env.DB, userId, body.identifier, 25);

    // Build profile from historical data
    const profile = buildProfileFromEmails(userId, profileType, body.identifier, emails);

    // Preserve existing profile ID if regenerating
    const existing = await getSenderProfile(c.env.DB, userId, profileType, body.identifier);
    if (existing) {
      profile.id = existing.id;
    }

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
    .json<{ summary?: string; label_counts?: Record<string, number> }>()
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
    if (body.label_counts !== undefined) {
      profile.labelCounts = body.label_counts;
    }

    await upsertSenderProfile(c.env.DB, profile);
    return c.json(profileToJSON(profile));
  } catch (e) {
    console.error('Failed to update sender profile:', e);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
}
