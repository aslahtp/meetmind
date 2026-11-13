import { Sparkles } from 'lucide-react';
import { useApp } from '../../../lib/app-context';
import GoogleCloudIcon from '../../GoogleCloudIcon';
import SarvamIcon from '../../SarvamIcon';
import AssemblyAiIcon from '../../AssemblyAiIcon';
import GeminiIcon from '../../GeminiIcon';
import GroqIcon from '../../GroqIcon';
import ClaudeIcon from '../../ClaudeIcon';

// Maps a provider descriptor's `icon` id to a component. Unknown ids get a generic icon,
// so a new provider works before its artwork is added.
const ICONS = {
  'google-cloud': GoogleCloudIcon,
  sarvam: SarvamIcon,
  assemblyai: AssemblyAiIcon,
  gemini: GeminiIcon,
  groq: GroqIcon,
  claude: ClaudeIcon,
};

export function providerIcon(iconId: any) {
  return (ICONS as any)[iconId] || Sparkles;
}

/** Icon of the note-generation provider selected in Settings (generic until providers load). */
export function useNotesProviderIcon() {
  const { setup } = useApp();
  return providerIcon(setup?.llm?.icon);
}
