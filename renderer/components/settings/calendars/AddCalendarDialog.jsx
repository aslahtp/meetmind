import React, { useEffect, useState } from 'react';
import { Link2, Loader2, LogIn } from 'lucide-react';
import GoogleCalendarIcon from '../../GoogleCalendarIcon.jsx';
import { AvatarTile, Dialog, PasswordField, SegmentedControl, StatusDot, TextField } from '../../ui/index.jsx';
import { GuideSteps, KeyGuide, RadioCardGroup } from '../SettingsParts.jsx';
import { ICS_GUIDES } from '../data.js';

const TYPES = [
  {
    id: 'ics',
    name: 'Calendar link (ICS)',
    badge: 'No setup',
    description: 'Paste a subscription link from Google, Outlook, Apple iCloud, Proton or any calendar that offers one.',
    icon: <Link2 size={20} strokeWidth={1.75} aria-hidden="true" />,
  },
  {
    id: 'google',
    name: 'Google account',
    badge: 'Advanced',
    description: 'Sign in to read your primary Google Calendar directly. Needs an OAuth client from your own Google Cloud project.',
    icon: <GoogleCalendarIcon size={20} />,
  },
];

/**
 * Two steps: pick the kind of calendar, then fill in its link or OAuth client. Adding checks the
 * link (or signs in) before anything is saved, so a calendar in the list always worked once.
 * `googleClient` ({ clientId, name }) prefills the client ID from a Google account already added.
 */
export default function AddCalendarDialog({ open, onClose, onAdded, googleClient, syncPhrase = 'every 5 minutes' }) {
  const [step, setStep] = useState('type');
  const [type, setType] = useState('ics');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [guide, setGuide] = useState(ICS_GUIDES[0].id);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Start fresh each time it opens.
  useEffect(() => {
    if (!open) return;
    setStep('type');
    setType('ics');
    setName('');
    setUrl('');
    setGuide(ICS_GUIDES[0].id);
    setClientId(googleClient?.clientId || '');
    setClientSecret('');
    setBusy(false);
    setError(null);
  }, [open, googleClient?.clientId]);

  const close = () => {
    if (busy && step === 'google') window.meetmind.calendar.cancelAuth();
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = step === 'ics'
        ? { type: 'ics', name, url }
        : { type: 'google', name, clientId, clientSecret };
      const result = await window.meetmind.calendar.add(input);
      if (result.success) {
        onAdded(result);
        onClose();
      } else if (!result.cancelled) {
        setError(result.error || 'Couldn’t add the calendar.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelSignIn = () => window.meetmind.calendar.cancelAuth();
  // Right under the fields, so it's in view without scrolling past the guide.
  const errorLine = error && (
    <p className="flex items-start gap-8 text-caption text-signal" role="alert">
      <StatusDot tone="error" className="mt-8" />
      {error}
    </p>
  );
  const reusesSecret = !!googleClient?.clientId && clientId.trim() === googleClient.clientId;
  const selectedGuide = ICS_GUIDES.find((g) => g.id === guide) || ICS_GUIDES[0];

  let footer;
  if (step === 'type') {
    footer = (
      <>
        <button type="button" onClick={close} className="btn-ghost btn-sm">Cancel</button>
        <button type="button" onClick={() => { setStep(type); setError(null); }} className="btn-ink btn-sm">Continue</button>
      </>
    );
  } else if (step === 'google' && busy) {
    footer = (
      <>
        <button type="button" onClick={cancelSignIn} className="btn-ghost btn-sm">Cancel sign-in</button>
        <button type="button" disabled className="btn-ink btn-sm">
          <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />
          Waiting for your browser…
        </button>
      </>
    );
  } else {
    footer = (
      <>
        <button type="button" onClick={() => { setStep('type'); setError(null); }} disabled={busy} className="btn-ghost btn-sm">Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || (step === 'ics' ? !url.trim() : !clientId.trim() || (!clientSecret && !reusesSecret))}
          className="btn-ink btn-sm"
        >
          {busy ? (
            <>
              <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />
              Checking link…
            </>
          ) : step === 'ics' ? (
            'Add calendar'
          ) : (
            <>
              <LogIn size={14} strokeWidth={1.75} aria-hidden="true" />
              Sign in with Google
            </>
          )}
        </button>
      </>
    );
  }

  const titles = {
    type: 'Add a calendar',
    ics: 'Add a calendar link',
    google: 'Connect a Google account',
  };
  const descriptions = {
    type: 'Upcoming meetings show on your Dashboard, with a prompt to record when one starts.',
    ics: `MeetMind checks the link now, then refreshes it ${syncPhrase}.`,
    google: 'Sign-in opens in your browser. MeetMind only asks to read your calendar.',
  };

  return (
    <Dialog open={open} onClose={close} title={titles[step]} description={descriptions[step]} footer={footer} dismissible={!busy || step === 'google'}>
      {step === 'type' && (
        <RadioCardGroup
          label="Calendar type"
          options={TYPES}
          value={type}
          onChange={setType}
          className="space-y-16"
          renderOption={(t) => (
            <span className="flex items-start gap-16">
              <AvatarTile size={40}>{t.icon}</AvatarTile>
              <span className="flex-1 min-w-0 block">
                <span className="flex flex-wrap items-center gap-8">
                  <span className="text-body-sm font-medium text-ink">{t.name}</span>
                  <span className="pill-quiet">{t.badge}</span>
                </span>
                <span className="block text-caption text-graphite mt-8">{t.description}</span>
              </span>
            </span>
          )}
        />
      )}

      {step === 'ics' && (
        <form className="space-y-24" onSubmit={(e) => { e.preventDefault(); if (url.trim() && !busy) submit(); }}>
          <PasswordField
            id="calendar-ics-url"
            label="Calendar link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or webcal://…"
            hint="Keep it private: anyone with this link can see the calendar’s events."
            disabled={busy}
          />
          <TextField
            id="calendar-ics-name"
            label="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Taken from the calendar if left empty"
            maxLength={60}
            disabled={busy}
          />
          {errorLine}
          <div className="space-y-16">
            <p className="label">Where to find the link</p>
            <SegmentedControl
              label="Calendar app"
              role="radiogroup"
              size="sm"
              options={ICS_GUIDES.map((g) => ({ value: g.id, label: g.label }))}
              value={guide}
              onChange={setGuide}
            />
            <GuideSteps steps={selectedGuide.steps} />
          </div>
          {/* Lets Enter in either field submit the form. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}

      {step === 'google' && (
        <form className="space-y-24" onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
          <div className="space-y-16">
            <TextField
              id="calendar-google-client-id"
              label="OAuth client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value.trim())}
              placeholder="xxxxxxxxx.apps.googleusercontent.com"
              disabled={busy}
            />
            <PasswordField
              id="calendar-google-secret"
              label="OAuth client secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={reusesSecret ? 'Saved' : 'GOCSPX-...'}
              hint={reusesSecret ? `Leave empty to reuse the secret saved with ${googleClient.name}.` : undefined}
              disabled={busy}
            />
            <KeyGuide provider="google-calendar" title="How to create OAuth credentials" />
          </div>
          <TextField
            id="calendar-google-name"
            label="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your Google email if left empty"
            maxLength={60}
            disabled={busy}
          />
          {errorLine}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}

    </Dialog>
  );
}
