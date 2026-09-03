<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import type { MeshData } from './types';

	interface Props {
		meshData?: MeshData | null;
		url?: string | null;
		showAxes?: boolean;
		showGrid?: boolean;
	}

	let { meshData = null, url = null, showAxes = true, showGrid: showGridProp = true }: Props = $props();

	let container: HTMLDivElement = $state(undefined as unknown as HTMLDivElement);
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let viewHelper: ViewHelper | null = null;
	let currentMesh: THREE.Mesh | null = null;
	let edgeLines: THREE.LineSegments | null = null;
	let gridHelper: THREE.GridHelper | null = null;
	let axisHelper: THREE.AxesHelper | null = null;
	let animationId: number;
	let webglError = $state(false);
	let mounted = $state(false);
	let edgeOnly = $state(false);
	let showAxisState = $state(true);
	let showGridState = $state(true);
	let hasLoadedOnce = false;

	$effect(() => {
		showAxisState = showAxes;
	});
	$effect(() => {
		showGridState = showGridProp;
	});

	function fitCamera(mesh: THREE.Object3D) {
		if (!camera || !controls) return;
		const box = new THREE.Box3().setFromObject(mesh);
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		camera.position.set(
			center.x + maxDim * 1.2,
			center.y - maxDim * 1.2,
			center.z + maxDim * 0.8,
		);
		controls.target.copy(center);
		controls.update();
	}

	function resetView() {
		if (!currentMesh) return;
		fitCamera(currentMesh);
	}

	function toggleEdgeOnly() {
		edgeOnly = !edgeOnly;
		applyEdgeOnly();
	}

	function applyEdgeOnly() {
		if (currentMesh) {
			const mat = currentMesh.material as THREE.MeshPhongMaterial;
			mat.transparent = edgeOnly;
			mat.opacity = edgeOnly ? 0 : 1;
			mat.depthWrite = !edgeOnly;
		}
	}

	function toggleAxis() {
		showAxisState = !showAxisState;
		if (axisHelper) axisHelper.visible = showAxisState;
	}

	function toggleGrid() {
		showGridState = !showGridState;
		if (gridHelper) gridHelper.visible = showGridState;
	}

	function removeMesh() {
		if (!scene) return;
		if (edgeLines) {
			scene.remove(edgeLines);
			edgeLines.geometry.dispose();
			(edgeLines.material as THREE.Material).dispose();
			edgeLines = null;
		}
		if (!currentMesh) return;
		scene.remove(currentMesh);
		currentMesh.geometry.dispose();
		const mat = currentMesh.material;
		if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
		else (mat as THREE.Material).dispose();
		currentMesh = null;
	}

	function loadMesh(mesh: THREE.Mesh) {
		if (!scene) return;
		removeMesh();
		currentMesh = mesh;
		scene.add(mesh);
		if (!hasLoadedOnce) {
			fitCamera(mesh);
			hasLoadedOnce = true;
		}
	}

	function loadFromMeshData(data: MeshData) {
		const hasFaces = data.positions.length > 0 && data.indices.length > 0;
		const hasLines = data.lines && data.lines.positions.length > 0 && data.lines.indices.length > 0;

		// Build a Three.js Mesh to stand in for the current shape. If there are
		// no faces (only open-wire lines), use an empty placeholder mesh so the
		// existing view-fit logic still works via bbox of children.
		let mesh: THREE.Mesh;
		if (hasFaces) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
			if (data.normals && data.normals.length > 0) {
				geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
			}
			geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
			if (!geometry.getAttribute('normal')) {
				geometry.computeVertexNormals();
			}
			let material: THREE.MeshPhongMaterial;
			if (data.colors) {
				geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
				material = new THREE.MeshPhongMaterial({
					vertexColors: true,
					specular: 0x222222,
					shininess: 40
				});
			} else {
				const rgb = data.color ?? [1.0, 0.92, 0.3];
				material = new THREE.MeshPhongMaterial({
					color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
					specular: 0x222222,
					shininess: 40
				});
			}
			mesh = new THREE.Mesh(geometry, material);
			if (data.edgePoints && data.edgePoints.length > 0) {
				const edgeGeometry = new THREE.BufferGeometry();
				edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.edgePoints, 3));
				edgeLines = new THREE.LineSegments(
					edgeGeometry,
					new THREE.LineBasicMaterial({ color: 0x000000 })
				);
			} else {
				const edges = new THREE.EdgesGeometry(geometry, 10);
				edgeLines = new THREE.LineSegments(
					edges,
					new THREE.LineBasicMaterial({ color: 0x000000 })
				);
			}
			mesh.add(edgeLines);
		} else {
			// No face data — create an empty mesh placeholder
			mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhongMaterial({ visible: false }));
		}

		// Add open-wire lines (path literals etc.) as a separate LineSegments child.
		if (hasLines) {
			const lineGeom = new THREE.BufferGeometry();
			lineGeom.setAttribute('position', new THREE.BufferAttribute(data.lines!.positions, 3));
			lineGeom.setIndex(new THREE.BufferAttribute(data.lines!.indices, 1));
			// Orchid (purple-pink) to stand out from primary colors
			// (blue/red/green/yellow) that are typically used for axes and faces.
			const wireLines = new THREE.LineSegments(
				lineGeom,
				new THREE.LineBasicMaterial({ color: 0xba55d3, linewidth: 2 })
			);
			mesh.add(wireLines);
		}

		loadMesh(mesh);
		applyEdgeOnly();
	}

	function loadFromUrl(glbUrl: string) {
		new GLTFLoader().load(glbUrl, (gltf) => {
			gltf.scene.traverse((child) => {
				if ((child as THREE.Mesh).isMesh) {
					loadMesh(child as THREE.Mesh);
				}
			});
		});
	}

	// React to meshData / url changes after mount
	$effect(() => {
		const _data = meshData;
		const _url = url;
		if (!mounted) return;
		if (_data) {
			loadFromMeshData(_data);
		} else if (_url) {
			loadFromUrl(_url);
		} else {
			removeMesh();
		}
	});

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xf7fafc);

		camera = new THREE.PerspectiveCamera(
			50,
			container.clientWidth / container.clientHeight,
			0.1,
			10000
		);
		camera.up.set(0, 0, 1);

		try {
			renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
		} catch {
			webglError = true;
			return;
		}
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.autoClear = false;
		container.appendChild(renderer.domElement);

		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;

		viewHelper = new ViewHelper(camera, renderer.domElement);
		viewHelper.setLabels('X', 'Y', 'Z');
		renderer.domElement.addEventListener('pointerup', (event) => {
			viewHelper!.handleClick(event);
		});

		scene.add(new THREE.AmbientLight(0xffffff, 0.6));
		const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
		dirLight.position.set(1, 1, 1);
		scene.add(dirLight);
		const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
		backLight.position.set(-1, -1, -1);
		scene.add(backLight);

		gridHelper = new THREE.GridHelper(100, 20, 0xcccccc, 0xe0e0e0);
		gridHelper.rotation.x = Math.PI / 2;
		gridHelper.visible = showGridState;
		scene.add(gridHelper);

		axisHelper = new THREE.AxesHelper(50);
		axisHelper.visible = showAxisState;
		scene.add(axisHelper);

		camera.position.set(60, -60, 40);
		controls.update();

		const timer = new THREE.Timer();
		function animate() {
			animationId = requestAnimationFrame(animate);
			timer.update();
			const delta = timer.getDelta();
			controls!.update();
			if (viewHelper!.animating) viewHelper!.update(delta);
			renderer!.clear();
			renderer!.render(scene!, camera!);
			viewHelper!.render(renderer!);
		}
		animate();

		const ro = new ResizeObserver(() => {
			if (!renderer || !camera) return;
			const w = container.clientWidth;
			const h = container.clientHeight;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		});
		ro.observe(container);

		mounted = true;

		// Load initial data
		if (meshData) {
			loadFromMeshData(meshData);
		} else if (url) {
			loadFromUrl(url);
		}

		return () => ro.disconnect();
	});

	onDestroy(() => {
		if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animationId);
		renderer?.dispose();
	});

	export function exportSVG(): string {
		if (!currentMesh || !camera || !renderer) throw new Error('Not ready');
		const w = renderer.domElement.width;
		const h = renderer.domElement.height;

		// Collect edge line segments in world space
		const segments: [THREE.Vector3, THREE.Vector3][] = [];
		currentMesh.traverse((child) => {
			if (child instanceof THREE.LineSegments) {
				const geo = child.geometry;
				const pos = geo.getAttribute('position');
				child.updateMatrixWorld(true);
				for (let i = 0; i < pos.count; i += 2) {
					const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
					const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(child.matrixWorld);
					segments.push([a, b]);
				}
			}
		});

		// Project to screen coords
		const project = (v: THREE.Vector3): [number, number] => {
			const ndc = v.clone().project(camera!);
			return [(ndc.x + 1) / 2 * w, (1 - ndc.y) / 2 * h];
		};

		let lines = '';
		for (const [a, b] of segments) {
			const [x1, y1] = project(a);
			const [x2, y2] = project(b);
			lines += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>\n`;
		}

		return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<g stroke="#000" stroke-width="1" stroke-linecap="round">
${lines}</g>
</svg>`;
	}

	export function screenshot(): Promise<Blob> {
		return new Promise((resolve, reject) => {
			if (!renderer) {
				reject(new Error('Renderer not ready'));
				return;
			}
			renderer.domElement.toBlob(
				(blob) => {
					if (blob) resolve(blob);
					else reject(new Error('Failed to capture screenshot'));
				},
				'image/png'
			);
		});
	}

	async function takeScreenshot(): Promise<void> {
		if (!renderer || !scene || !camera) return;

		const gridWas = gridHelper?.visible ?? false;
		const axisWas = axisHelper?.visible ?? false;

		if (gridHelper) gridHelper.visible = false;
		if (axisHelper) axisHelper.visible = false;

		renderer.clear();
		renderer.render(scene, camera);

		const blob = await new Promise<Blob>((resolve, reject) => {
			renderer!.domElement.toBlob(
				(b) => {
					if (b) resolve(b);
					else reject(new Error('Failed to capture screenshot'));
				},
				'image/png'
			);
		});

		if (gridHelper) gridHelper.visible = gridWas;
		if (axisHelper) axisHelper.visible = axisWas;

		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `polyscript_${ts}.png`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

{#if webglError}
	<div class="viewer fallback">
		<p>3D preview unavailable (WebGL not supported)</p>
	</div>
{:else}
	<div class="viewer-wrapper">
		<div class="viewer" bind:this={container}></div>
		<div class="viewer-toolbar">
			<button class="tb-btn" onclick={resetView} title="Reset view">&#x27F3;</button>
			<button class="tb-btn" class:active={edgeOnly} onclick={toggleEdgeOnly} title="Edge only">&#x25C7;</button>
			<button class="tb-btn" class:active={showAxisState} onclick={toggleAxis} title="Axes">&#x22B9;</button>
			<button class="tb-btn" class:active={showGridState} onclick={toggleGrid} title="Grid">&#x229E;</button>
			<button class="tb-btn" onclick={takeScreenshot} title="Screenshot">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="7" width="20" height="14" rx="2"/>
					<circle cx="12" cy="14" r="4"/>
					<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
				</svg>
			</button>
		</div>
	</div>
{/if}

<style>
	.viewer {
		width: 100%;
		height: 100%;
		min-height: 200px;
	}
	.viewer-wrapper {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.viewer-toolbar {
		position: absolute;
		top: 6px;
		left: 6px;
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 6px;
		padding: 2px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
		z-index: 10;
	}
	.tb-btn {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		border-radius: 4px;
		cursor: pointer;
		font-size: 15px;
		line-height: 28px;
		text-align: center;
		color: #555;
		padding: 0;
	}
	.tb-btn:hover {
		background: #e2e8f0;
	}
	.tb-btn.active {
		background: #e6fffa;
		color: #319795;
	}
	.fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f7fafc;
		color: #a0aec0;
		height: 100%;
		min-height: 200px;
	}
</style>
