/** One row of the download menu. `id` is passed back to the host, which owns
 *  the actual export -- the menu knows nothing about formats. */
export interface DownloadItem {
	id: string;
	/** Format name, e.g. "STL". */
	label: string;
	/** One short line saying what the file is for. */
	hint?: string;
	/** Not producible right now (nothing built, no viewer, ...). */
	disabled?: boolean;
}

/**
 * The mesh types come from core, where everything that touches a mesh can
 * reach them. Re-exported here so `@polyscript/ui` keeps the surface it
 * always had.
 */
export type { MeshData, MeshPart } from '@polyscript/core';

/**
 * Every word ModelWorkbench puts on screen.
 *
 * Passed in rather than translated here: the workbench is a component, and
 * which languages a site speaks -- and how it words things -- is the site's
 * own business.
 */
export interface WorkbenchLabels {
	/** Tab names. */
	overview: string;
	download: string;
	params: string;
	source: string;
	/** Shown in place of the model when there is nothing to show yet. */
	noPreview: string;
	/** The model declares no adjustable parameters. */
	noParams: string;
	/** A file is being produced; covers the build as well as the write. */
	preparing: string;
	building: string;
	ready: string;
	buildFailed: string;
	downloadFailed: string;
}
