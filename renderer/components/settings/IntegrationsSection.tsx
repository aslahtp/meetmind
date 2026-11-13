import React, { useState } from 'react';
import NotionIcon from '../NotionIcon';
import { PasswordField, TextField, Switch } from '../ui/index';
import { SettingsGroup, SettingRow, KeyGuide, TestAction, ExternalLink } from './SettingsParts';
import CalendarsCard from './calendars/CalendarsCard';

function notionSuccessLabel(result: any) {
  if (result?.type === 'page') return 'Notion page connected';
  if (result?.type === 'database') return 'Notion database connected';
  return 'Notion connected';
}

export default function IntegrationsSection({ form, onChange }: { form?: any; onChange?: any }) {
  const [testingNotion, setTestingNotion] = useState(false);
  const [notionResult, setNotionResult] = useState<any>(null);

  const handleTestNotion = async () => {
    setTestingNotion(true);
    setNotionResult(null);
    try {
      const result = await window.meetmind.notion.testConnection(form.notionApiKey, form.notionDatabaseId);
      setNotionResult(result);
    } catch (err: any) {
      setNotionResult({ success: false, error: err.message });
    } finally {
      setTestingNotion(false);
    }
  };

  return (
    <div className="space-y-24">
      <CalendarsCard />

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
            onChange={(e: any) => onChange('notionApiKey', e.target.value)}
            placeholder="secret_..."
          />
          <KeyGuide provider="notion" title="How to connect Notion" />
        </div>

        <TextField
          id="notion-target"
          label="Parent page or database ID"
          hint={'Paste the 32-character ID or full Notion URL. Connect the MeetMind integration from the page or database "..." menu first.'}
          value={form.notionDatabaseId || ''}
          onChange={(e: any) => onChange('notionDatabaseId', e.target.value.trim())}
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
            onChange={(v: any) => onChange('notionUploadTranscript', v)}
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
    </div>
  );
}
