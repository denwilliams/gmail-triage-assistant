import { Hono } from 'hono';
import type { Env } from './types/env';
import { authMiddleware } from './auth/jwt';
import { handleLogin, handleCallback, handleLogout } from './auth/oauth';

// API handlers
import { handleGetLabels, handleCreateLabel, handleUpdateLabel, handleDeleteLabel } from './api/labels';
import { handleGetEmails, handleUpdateFeedback } from './api/emails';
import { handleGetPrompts, handleUpdatePrompt, handleInitDefaults } from './api/prompts';
import { handleGetMemories, handleGenerateMemory, handleGenerateAIPrompts } from './api/memories';
import { handleGetSettings, handleUpdatePushover, handleUpdateWebhook } from './api/settings';
import { handleGetNotifications } from './api/notifications';
import { handleGetWrapups } from './api/wrapups';
import { handleGetStatsSummary, handleGetStatsTimeseries } from './api/stats';
import {
  handleGetSenderProfiles,
  handleGenerateSenderProfile,
  handleUpdateSenderProfile,
} from './api/sender-profiles';
import { handlePromptWizardStart, handlePromptWizardContinue } from './api/prompt-wizard';
import { handleExport, handleImport } from './api/export-import';

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
api.put('/prompts', handleUpdatePrompt);
api.post('/prompts/defaults', handleInitDefaults);

// Memories
api.get('/memories', handleGetMemories);
api.post('/memories/generate', handleGenerateMemory);
api.post('/memories/generate-ai-prompts', handleGenerateAIPrompts);

// Settings
api.get('/settings', handleGetSettings);
api.put('/settings/pushover', handleUpdatePushover);
api.put('/settings/webhook', handleUpdateWebhook);

// Notifications
api.get('/notifications', handleGetNotifications);

// Wrapups
api.get('/wrapups', handleGetWrapups);

// Stats
api.get('/stats/summary', handleGetStatsSummary);
api.get('/stats/timeseries', handleGetStatsTimeseries);

// Sender profiles
api.get('/sender-profiles', handleGetSenderProfiles);
api.post('/sender-profiles/generate', handleGenerateSenderProfile);
api.patch('/sender-profiles/:id', handleUpdateSenderProfile);

// Prompt wizard
api.post('/prompt-wizard/start', handlePromptWizardStart);
api.post('/prompt-wizard/continue', handlePromptWizardContinue);

// Export / Import
api.get('/export', handleExport);
api.post('/import', handleImport);

app.route('/api/v1', api);

export default app;
