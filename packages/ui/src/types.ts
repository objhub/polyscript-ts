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

export interface MeshPart {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	color?: [number, number, number]; // RGB 0..1
	alpha?: number; // 0..1, default 1
}

export interface MeshData {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	color?: [number, number, number];
	colors?: Float32Array; // per-vertex RGB
	/** Multi-color models: one mesh per part, each with its own material.
	 *  When present the top-level positions/indices are empty. */
	parts?: MeshPart[];
	edgePoints?: Float32Array; // CAD-level edge polylines (XYZ interleaved)
	lines?: {
		positions: Float32Array;
		indices: Uint32Array;
	}; // Open wires rendered as LineSegments
}
