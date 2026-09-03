export { default as ModelViewer } from './ModelViewer.svelte';
export { default as CodeEditor } from './CodeEditor.svelte';
export { default as ParamsPanel } from './ParamsPanel.svelte';
export type { MeshData } from './types';
export { CUSTOM_PRESET, findMatchingPreset } from './profile-helpers.js';
export type { Profile, ProfileEntry } from './profile-helpers.js';
export {
  polyscriptLanguageSupport,
  polyscriptCompletion,
  polyscriptHoverExtension,
  polyscriptHoverTooltip,
} from './polyscript-language.js';
