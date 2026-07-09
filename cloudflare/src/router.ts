import { Hono } from 'hono';
import type { Env } from './types/env';
import { authMiddleware } from './auth/jwt';
import { handleLogin, handleCallback, handleLogout } from './auth/oauth';

// API handlers
import { handleGetLabels, handleCreateLabel, handleUpdateLabel, handleDeleteLabel } from './api/labels';
import { handleGetEmails, handleUpdateFeedback } from './api/emails';
import { handleGetPrompts, handleUpdatePrompt, handleInitDefaults, handleGetDefaultPrompts } from './api/prompts';
import { handleGetMemories, handleGenerateMemory, handleGenerateAIPrompts } from './api/memories';
import {
  handleGetSettings,
  handleUpdatePipelineVersion,
  handleUpdateProcessing,
  handleUpdatePushover,
  handleUpdateV2Settings,
  handleUpdateWebhook,
} from './api/settings';
import { handleGetNotifications } from './api/notifications';
import { handleGetWrapups } from './api/wrapups';
import {
  handleGetBucketStats,
  handleGetStatsSummary,
  handleGetStatsTimeseries,
  handleGetV2PipelineStats,
  handleGetNewsletterThresholdDistribution,
  handleGetHumanRatingThresholdDistribution,
} from './api/stats';
import {
  handleGetAllSenderProfiles,
  handleGetSenderProfiles,
  handleGenerateSenderProfile,
  handleRateSenderNow,
  handleUpdateSenderProfile,
} from './api/sender-profiles';
import { handlePromptWizardStart, handlePromptWizardContinue } from './api/prompt-wizard';
import { handleExport, handleImport } from './api/export-import';
import { handleGenerateDigestNow, handleGetDigest, handleListDigests } from './api/digests';
import { handleGetDay } from './api/day';
import {
  handleGetPipelineConfig,
  handleGetPipelineOps,
  handlePipelineRetry,
} from './api/pipeline';
import {
  handleGetPwaEmails,
  handleGetPwaEmailContent,
  handlePwaReply,
  handlePwaArchive,
  handlePwaUnarchive,
  handlePwaTrash,
  handlePwaSetRead,
  handlePwaSetCollapsed,
  handlePwaSetBucket,
} from './api/pwa';

// Define custom variables type for auth context
type AppEnv = { Bindings: Env; Variables: { userId: number; email: string } };

const app = new Hono<AppEnv>();

// Health check (no auth)
app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));

// Auth routes (no middleware)
app.get('/auth/login', handleLogin as any);
app.get('/auth/callback', handleCallback as any);
app.get('/auth/logout', handleLogout as any);

// API routes with auth middleware
const api = new Hono<AppEnv>();
api.use('*', authMiddleware);

// Auth
api.get('/auth/me', (c) => {
  return c.json({ email: c.get('email'), user_id: c.get('userId') });
});

// Labels
api.get('/labels', handleGetLabels);
api.post('/labels', handleCreateLabel);
api.put('/labels/:id', handleUpdateLabel);
api.delete('/labels/:id', handleDeleteLabel);

// Emails
api.get('/emails', handleGetEmails);
api.put('/emails/:id/feedback', handleUpdateFeedback);

// Prompts
api.get('/prompts', handleGetPrompts);
api.get('/prompts/defaults', handleGetDefaultPrompts);
api.put('/prompts', handleUpdatePrompt);
api.post('/prompts/defaults', handleInitDefaults);

// Memories
api.get('/memories', handleGetMemories);
api.post('/memories/generate', handleGenerateMemory);
api.post('/memories/generate-ai-prompts', handleGenerateAIPrompts);

// Settings
api.get('/settings', handleGetSettings);
api.put('/settings/processing', handleUpdateProcessing);
api.put('/settings/pipeline-version', handleUpdatePipelineVersion);
api.put('/settings/pushover', handleUpdatePushover);
api.put('/settings/webhook', handleUpdateWebhook);
api.put('/settings/v2', handleUpdateV2Settings);

// Notifications
api.get('/notifications', handleGetNotifications);

// Wrapups
api.get('/wrapups', handleGetWrapups);

// Daily digests (v2 pipeline)
api.get('/digests', handleListDigests);
api.get('/digests/:date', handleGetDigest);
api.post('/digests/generate', handleGenerateDigestNow);

// On-the-fly per-day email view (separate from digests). No-date variant
// resolves to "today" in env.TIMEZONE on the server.
api.get('/days', handleGetDay);
api.get('/days/:date', handleGetDay);

// Stats
api.get('/stats/summary', handleGetStatsSummary);
api.get('/stats/timeseries', handleGetStatsTimeseries);
api.get('/stats/v2-pipeline', handleGetV2PipelineStats);
api.get('/stats/bucket/:bucket', handleGetBucketStats);
api.get('/stats/threshold/newsletter', handleGetNewsletterThresholdDistribution);
api.get('/stats/threshold/human-rating', handleGetHumanRatingThresholdDistribution);

// Pipeline ops
api.get('/pipeline/config', handleGetPipelineConfig);
api.get('/pipeline/ops', handleGetPipelineOps);
api.post('/pipeline/retry/:id', handlePipelineRetry);

// Sender profiles
api.get('/sender-profiles/all', handleGetAllSenderProfiles);
api.get('/sender-profiles', handleGetSenderProfiles);
api.post('/sender-profiles/generate', handleGenerateSenderProfile);
api.patch('/sender-profiles/:id', handleUpdateSenderProfile);
api.post('/sender-profiles/:id/rate', handleRateSenderNow);

// Prompt wizard
api.post('/prompt-wizard/start', handlePromptWizardStart);
api.post('/prompt-wizard/continue', handlePromptWizardContinue);

// Export / Import
api.get('/export', handleExport);
api.post('/import', handleImport);

// PWA mail client (served at /m/)
api.get('/m/emails', handleGetPwaEmails);
api.get('/m/emails/:id/content', handleGetPwaEmailContent);
api.post('/m/emails/:id/reply', handlePwaReply);
api.post('/m/emails/:id/archive', handlePwaArchive);
api.post('/m/emails/:id/unarchive', handlePwaUnarchive);
api.post('/m/emails/:id/trash', handlePwaTrash);
api.post('/m/emails/:id/read', handlePwaSetRead);
api.post('/m/emails/:id/collapsed', handlePwaSetCollapsed);
api.post('/m/emails/:id/bucket', handlePwaSetBucket);

app.route('/api/v1', api);

// SPA fallback — serve static assets for all non-API/auth routes.
// The PWA is a second SPA under /m/: deep routes without a file extension
// resolve to its index.html instead of falling through to the dashboard SPA
// (the assets binding's single-page-application handling only knows about the
// root index.html).
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname === '/m' || url.pathname.startsWith('/m/')) {
    if (!/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
      url.pathname = '/m';
      return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    }
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
