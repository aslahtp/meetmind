import type { ComponentType } from 'react';
import { Sparkles, type LucideIcon } from 'lucide-react';
import { useApp } from '../../../lib/app-context';
import GoogleCloudIcon from '../../GoogleCloudIcon';
import SarvamIcon from '../../SarvamIcon';
import AssemblyAiIcon from '../../AssemblyAiIcon';
import GeminiIcon from '../../GeminiIcon';
import GroqIcon from '../../GroqIcon';
import ClaudeIcon from '../../ClaudeIcon';

// Maps a provider descriptor's `icon` id to a component. Unknown ids get a generic icon,
// so a new provider works before its artwork is added.
/** A provider's icon: its own artwork, or the generic Lucide one. Both take `size`. */
export type ProviderIcon = ComponentType<{ size?: number }> | LucideIcon;

const ICONS: Record<string, ProviderIcon> = {
  'google-cloud': GoogleCloudIcon,
  sarvam: SarvamIcon,
  assemblyai: AssemblyAiIcon,
  gemini: GeminiIcon,
  groq: GroqIcon,
  claude: ClaudeIcon,
};

export function providerIcon(iconId: string | undefined): ProviderIcon {
  return (iconId && ICONS[iconId]) || Sparkles;
}

/** Icon of the note-generation provider selected in Settings (generic until providers load). */
export function useNotesProviderIcon() {
  const { setup } = useApp();
  return providerIcon(setup?.llm?.icon);
}
