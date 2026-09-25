/**
 * What each engine can write, as plain data.
 *
 * Kept out of the engine modules so a page can render the list without
 * pulling in a worker or 22 MB of WASM: the public object page names STL,
 * STEP and GLB in its server-rendered HTML, which is what a search for
 * "bolt stl" has to find. The engines import the same arrays, so the menu
 * and what the menu can actually produce cannot drift apart.
 */
import type { EngineType } from './types';

export interface ExportFormat {
	id: string;
	label: string;
	hintKey: string;
	extension: string;
}

const STL: ExportFormat = { id: 'stl', label: 'STL', hintKey: 'editor.downloadStl', extension: 'stl' };
const STEP: ExportFormat = { id: 'step', label: 'STEP', hintKey: 'editor.downloadStep', extension: 'step' };
const GLB: ExportFormat = { id: 'glb', label: 'GLB', hintKey: 'editor.downloadGlb', extension: 'glb' };

export const POLY_FORMATS: ExportFormat[] = [STL, STEP, GLB];
export const SCAD_FORMATS: ExportFormat[] = [STL, GLB];

/** The formats an object of this type can be written to. */
export function formatsFor(type: EngineType): ExportFormat[] {
	return type === 'poly' ? POLY_FORMATS : SCAD_FORMATS;
}
