export interface MeshData {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	color?: [number, number, number];
	colors?: Float32Array; // per-vertex RGB
	edgePoints?: Float32Array; // CAD-level edge polylines (XYZ interleaved)
	lines?: {
		positions: Float32Array;
		indices: Uint32Array;
	}; // Open wires rendered as LineSegments
}
