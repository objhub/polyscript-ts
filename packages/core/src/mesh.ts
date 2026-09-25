/**
 * The mesh interchange types.
 *
 * They live in core because this is what tessellation produces and what every
 * layer above passes along: the worker that builds, the engines that export,
 * the viewer that draws. Any other home makes one of those depend on a
 * package it has no other use for -- the viewer on an exporter, or an exporter
 * on the viewer.
 */

/** One coloured piece of a model, drawn with its own material. */
export interface MeshPart {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	/** RGB, 0..1. */
	color?: [number, number, number];
	/** 0..1, default 1. */
	alpha?: number;
}

export interface MeshData {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	color?: [number, number, number];
	/** Per-vertex RGB. */
	colors?: Float32Array;
	/** Multi-colour models: one mesh per part, each with its own material.
	 *  When present the top-level positions/indices are empty. */
	parts?: MeshPart[];
	/** CAD-level edge polylines (XYZ interleaved). */
	edgePoints?: Float32Array;
	/** Open wires, drawn as LineSegments. */
	lines?: {
		positions: Float32Array;
		indices: Uint32Array;
	};
}
