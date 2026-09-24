import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../../app.jsx';
import NotionIcon from '../NotionIcon.jsx';
import GoogleCalendarIcon from '../GoogleCalendarIcon.jsx';
import { PasswordField, TextField, Switch, StatusDot } from '../ui/index.jsx';
import { SettingsGroup, SettingRow, KeyGuide, TestAction, ExternalLink } from './SettingsParts.jsx';

function notionSuccessLabel(result) {
  if (result?.type === 'page') return 'Notion page connected';
  if (result?.type === 'database') return 'Notion database connected';
  return 'Notion connected';
}

export default function IntegrationsSection({ form, onChange }) {
  const { confirm } = useApp();
  const [testingNotion, setTestingNotion] = useState(false);
  const [notionResult, setNotionResult] = useState(null);
  const [calendarStatus, setCalendarStatus] = useState({ connected: false, email: '' });
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState(null);

  useEffect(() => {
    async function loadCalendarStatus() {
      if (!window.meetmind?.calendar?.getStatus) return;
      try {
        const status = await window.meetmind.calendar.getStatus();
        setCalendarStatus(status);
      } catch {}
    }
    loadCalendarStatus();
  }, []);

  const handleTestNotion = async () => {
    setTestingNotion(true);
    setNotionResult(null);
    try {
      const result = await window.meetmind.notion.testConnection(form.notionApiKey, form.notionDatabaseId);
      setNotionResult(result);
    } catch (err) {
      setNotionResult({ success: false, error: err.message });
    } finally {
      setTestingNotion(false);
    }
  };

  const handleConnectCalendar = async () => {
    if (!form.googleCalendarClientId || !form.googleCalendarClientSecret) {
      setCalendarError('Enter your OAuth Client ID and Client Secret first.');
      return;
    }
    setConnectingCalendar(true);
    setCalendarError(null);
    try {
      // Save credentials first so the main process can use them
      await window.meetmind.config.setMultiple({
        googleCalendarClientId: form.googleCalendarClientId,
        googleCalendarClientSecret: form.googleCalendarClientSecret,
      });
      const result = await window.meetmind.calendar.auth();
      if (result.success) {
        setCalendarStatus({ connected: true, email: result.email || '' });
      } else {
        setCalendarError(result.error || 'Connection failed');
      }
    } catch (err) {
      setCalendarError(err.message);
    } finally {
      setConnectingCalendar(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    const ok = await confirm({
      title: 'Disconnect Google Calendar?',
      message: 'Upcoming meetings will no longer appear on the Dashboard. You can reconnect at any time.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await window.meetmind.calendar.disconnect();
      setCalendarStatus({ connected: false, email: '' });
      setCalendarError(null);
    } catch (err) {
      setCalendarError(err.message);
    }
  };

  return (
    <div className="space-y-24">
      <SettingsGroup
        title="Notion"
        description="Sync meeting notes into a Notion database or as child pages under any page."
        icon={<NotionIcon size={20} />}
        aside={<ExternalLink href="https://www.notion.so/profile/integrations">Create integration</ExternalLink>}
      >
        <div className="space-y-16">
          <PasswordField
            id="notion-key"
            label="Integration secret / API key"
            value={form.notionApiKey || ''}
            onChange={(e) => onChange('notionApiKey', e.target.value)}
            placeholder="secret_..."
          />
          <KeyGuide provider="notion" title="How to connect Notion" />
        </div>

        <TextField
          id="notion-target"
          label="Parent page or database ID"
          hint={'Paste the 32-character ID or full Notion URL. Connect the MeetMind integration from the page or database "..." menu first.'}
          value={form.notionDatabaseId || ''}
          onChange={(e) => onChange('notionDatabaseId', e.target.value.trim())}
          placeholder="Page ID, database ID, or full Notion URL"
        />

        <SettingRow
          label="Upload transcript"
          description="Include the full transcript as a collapsible section. Notes and summaries are always uploaded."
          htmlFor="notion-upload-transcript"
        >
          <Switch
            id="notion-upload-transcript"
            label="Upload transcript to Notion"
            checked={!!form.notionUploadTranscript}
            onChange={(v) => onChange('notionUploadTranscript', v)}
          />
        </SettingRow>

        <TestAction
          onClick={handleTestNotion}
          testing={testingNotion}
          label="Test Notion connection"
          result={notionResult}
          successLabel={notionSuccessLabel(notionResult)}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Google Calendar"
        description="See upcoming meetings on your Dashboard and get recording prompts."
        icon={<GoogleCalendarIcon size={20} />}
        aside={
          calendarStatus.connected ? (
            <span className="pill">
              <StatusDot tone="ok" />
              Connected
            </span>
          ) : (
            <ExternalLink href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</ExternalLink>
          )
        }
      >
        <div className="space-y-16">
          <TextField
            id="gcal-client-id"
            label="OAuth client ID"
            value={form.googleCalendarClientId || ''}
            onChange={(e) => onChange('googleCalendarClientId', e.target.value.trim())}
            placeholder="xxxxxxxxx.apps.googleusercontent.com"
          />
          <PasswordField
            id="gcal-secret"
            label="OAuth client secret"
            value={form.googleCalendarClientSecret || ''}
            onChange={(e) => onChange('googleCalendarClientSecret', e.target.value)}
            placeholder="GOCSPX-..."
          />
          <KeyGuide provider="google-calendar" title="How to create OAuth credentials" />
        </div>

        <div className="flex flex-wrap items-center gap-16">
          {calendarStatus.connected ? (
            <>
              <span className="inline-flex items-center gap-8 text-caption text-ink">
                <StatusDot tone="ok" />
                Connected as {calendarStatus.email || 'Google account'}
              </span>
              <button type="button" onClick={handleDisconnectCalendar} className="btn-danger btn-sm">
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConnectCalendar}
              disabled={connectingCalendar}
              className="btn-ink btn-sm"
            >
              {connectingCalendar ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="spinner" />
                  Connecting…
                </>
              ) : (
                'Connect Google Calendar'
              )}
            </button>
          )}

          {calendarError && (
            <span className="inline-flex items-center gap-8 text-caption text-signal" role="alert">
              <StatusDot tone="error" />
              {calendarError}
            </span>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
