import { Sparkles } from 'lucide-react';
import GoogleCloudIcon from '../../GoogleCloudIcon.jsx';
import SarvamIcon from '../../SarvamIcon.jsx';
import AssemblyAiIcon from '../../AssemblyAiIcon.jsx';
import GeminiIcon from '../../GeminiIcon.jsx';
import GroqIcon from '../../GroqIcon.jsx';

// Maps a provider descriptor's `icon` id to a component. Unknown ids get a generic icon,
// so a new provider works before its artwork is added.
const ICONS = {
  'google-cloud': GoogleCloudIcon,
  sarvam: SarvamIcon,
  assemblyai: AssemblyAiIcon,
  gemini: GeminiIcon,
  groq: GroqIcon,
};

export function providerIcon(iconId) {
  return ICONS[iconId] || Sparkles;
}
