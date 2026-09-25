<script lang="ts">
	import ModelViewer from './ModelViewer.svelte';
	import ParamsPanel from './ParamsPanel.svelte';
	import StatusBar from './StatusBar.svelte';
	import { findMatchingPreset } from './profile-helpers.js';
	import type { MeshData, Profile } from '@polyscript/core';
	import type { EngineType, ModelEngine, ModelSummary } from '@polyscript/engine';
	import { formatsFor } from '@polyscript/engine';
	import { onDestroy, type Snippet } from 'svelte';
	import type { WorkbenchLabels } from './types';

	interface Props {
		/** The model's source: built here, and shown in the source tab. */
		source: string;
		/** Which engine builds it. */
		type: EngineType;
		/** Every word the workbench shows. Nothing is translated in here -- the
		 *  host owns its wording and its languages. */
		labels: WorkbenchLabels;
		/** A ready-made preview, shown until the reader asks for a build. */
		glbUrl?: string | null;
		/** Names a downloaded file, before the extension. */
		filename?: string;
		/** Builds the engine. Called on the first build, so nothing it pulls in
		 *  is fetched for a reader who only looks at the model. */
		createEngine: () => Promise<ModelEngine>;
		/** The first tab's contents: whatever the host wants to say about the
		 *  model. It is the default tab, so this is what a server renders. */
		overview?: Snippet;
	}

	let {
		source,
		type,
		labels,
		glbUrl = null,
		filename = 'model',
		createEngine,
		overview
	}: Props = $props();

	/**
	 * Constructing an engine costs nothing: both implementations create their
	 * worker on the first build, so this only settles which formats the menu
	 * offers. The 22 MB of occt-wasm (9 MB for OpenSCAD) is fetched when
	 * something is actually built, which is why the import is dynamic -- a
	 * visitor who only looks at the model never pays for it.
	 */
	let engine: ModelEngine | null = null;
	onDestroy(() => engine?.dispose());

	let preparing = $state(false);
	let downloading = $state<string | null>(null);
	let built = $state(false);
	let tab = $state<'overview' | 'download' | 'params' | 'source'>('overview');
	let status = $state('');
	let statusError = $state(false);

	let mesh = $state<MeshData | null>(null);
	let meshInfo = $state<ModelSummary | null>(null);

	let params = $state<any[]>([]);
	let overrides = $state<Record<string, unknown>>({});
	let profile = $state<Profile | undefined>(undefined);
	let selectedPreset = $state<string | undefined>(undefined);
	let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

	// Every format this object can be written to, laid out rather than folded
	// into a menu: three names a person can recognise beat one button they have
	// to open to find out what is behind it. The names carry themselves --
	// anyone looking for an STL knows the word, and a gloss under it only asks
	// them to read something they did not need.
	//
	// Read from the table rather than from the engine, so the names are in the
	// server-rendered HTML. A page that says STL only after its JavaScript has
	// run does not say it to a crawler.
	const formats = $derived(formatsFor(type));

	async function build() {
		engine ??= await createEngine();
		preparing = true;
		status = labels.preparing;
		statusError = false;
		try {
			const result = await engine.build(source, { overrides: $state.snapshot(overrides) });

			// Only poly declares parameters; the other engine leaves them
			// undefined and the panel stays hidden.
			if (result.params && result.params.length > 0) params = result.params;
			if (result.profile !== undefined) profile = result.profile;
			updateSelectedPreset();

			if (!result.ok || !result.mesh) {
				status = `${labels.buildFailed}: ${result.errors.map((e) => e.message).join('\n')}`;
				statusError = true;
				built = false;
				return;
			}

			built = true;
			mesh = result.mesh;
			meshInfo = result.info ?? null;
			status = '';
			statusError = false;
		} catch (e) {
			status = `${labels.buildFailed}: ${e instanceof Error ? e.message : String(e)}`;
			statusError = true;
			built = false;
		} finally {
			preparing = false;
		}
	}

	function currentValues(): Record<string, unknown> {
		const values: Record<string, unknown> = {};
		for (const p of params) values[p.name] = p.name in overrides ? overrides[p.name] : p.default;
		return values;
	}

	function updateSelectedPreset() {
		selectedPreset = profile ? findMatchingPreset(profile, currentValues()) : undefined;
	}

	/** Rebuilding on every keystroke of a slider would queue builds that are
	 *  already obsolete; the last change within the window wins. */
	function scheduleRebuild() {
		if (rebuildTimer) clearTimeout(rebuildTimer);
		rebuildTimer = setTimeout(() => {
			rebuildTimer = null;
			build();
		}, 300);
	}

	function onParamChange(name: string, value: unknown) {
		overrides = { ...overrides, [name]: value };
		updateSelectedPreset();
		scheduleRebuild();
	}

	function onParamReset() {
		overrides = {};
		updateSelectedPreset();
		build();
	}

	/** Opening the tab is what asks for the parameters: they are declared in
	 *  the source and only a build reports them. */
	async function openParams() {
		tab = 'params';
		if (!built) await build();
	}

	function onPresetChange(name: string) {
		const entry = profile?.entries.find((e) => e.name === name);
		if (!entry) return;
		overrides = { ...overrides, ...entry.values };
		selectedPreset = name;
		scheduleRebuild();
	}

	/**
	 * Produce the file and hand it over.
	 *
	 * The build happens here rather than behind a button of its own: someone
	 * who wants an STL wants an STL, and the wait is the wait for their file.
	 */
	async function download(format: string) {
		if (downloading) return;
		downloading = format;
		try {
			if (!built) await build();
			if (!built || !engine) return;
			const file = await engine.exportFile(format);
			const url = URL.createObjectURL(file.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${filename}.${file.extension}`;
			a.click();
			// Revoking synchronously can beat the download in some browsers.
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
		} catch (e) {
			status = `${labels.downloadFailed}: ${e instanceof Error ? e.message : String(e)}`;
			statusError = true;
		} finally {
			downloading = null;
		}
	}

	onDestroy(() => {
		if (rebuildTimer) clearTimeout(rebuildTimer);
	});
</script>

<div class="object-view">
	<div class="build-panel">
		<div class="viewer">
			{#if built && mesh}
				{#key mesh}
					<ModelViewer meshData={mesh} info={meshInfo} />
				{/key}
			{:else if glbUrl}
				<ModelViewer url={glbUrl} />
			{:else}
				<div class="placeholder"><p>{labels.noPreview}</p></div>
			{/if}
		</div>

		<div class="side">
			<div class="tabs" role="tablist">
				<button
					role="tab"
					class="tab"
					class:active={tab === 'overview'}
					aria-selected={tab === 'overview'}
					onclick={() => (tab = 'overview')}
				>
					{labels.overview}
				</button>
				<button
					role="tab"
					class="tab"
					class:active={tab === 'download'}
					aria-selected={tab === 'download'}
					onclick={() => (tab = 'download')}
				>
					{labels.download}
				</button>
				<button
					role="tab"
					class="tab"
					class:active={tab === 'params'}
					aria-selected={tab === 'params'}
					onclick={openParams}
				>
					{labels.params}
				</button>
				<button
					role="tab"
					class="tab"
					class:active={tab === 'source'}
					aria-selected={tab === 'source'}
					onclick={() => (tab = 'source')}
				>
					{labels.source}
				</button>
			</div>

			<!-- Every panel stays in the document and the inactive ones are
			     hidden. Rendering only the open tab kept three quarters of the
			     page out of the server's HTML, where a search engine looking
			     for "bolt stl" would have to run scripts to find the word. -->
			<div class="tab-body" hidden={tab !== 'overview'}>
				{@render overview?.()}
			</div>

			<div class="tab-body" hidden={tab !== 'download'}>
				<div class="formats">
					{#each formats as f (f.id)}
						<button
							class="format"
							onclick={() => download(f.id)}
							disabled={downloading !== null || preparing}
						>
							{f.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="tab-body" hidden={tab !== 'params'}>
				{#if params.length > 0}
					<ParamsPanel
						{params}
						{overrides}
						onchange={onParamChange}
						onreset={onParamReset}
						{profile}
						{selectedPreset}
						onpresetchange={onPresetChange}
					/>
				{:else if built}
					<p class="empty">{labels.noParams}</p>
				{/if}
			</div>

			<div class="tab-body" hidden={tab !== 'source'}>
				<pre class="source"><code>{source}</code></pre>
			</div>

			{#if status}
				<StatusBar text={status} error={statusError} busy={preparing || downloading !== null} />
			{/if}
		</div>
	</div>
</div>

<style>
	/*
	 * Narrow: the model first, the tabs under it. A description can run long
	 * and nobody should have to scroll past text to see what they came for.
	 *
	 * Wide: the tabs take the left and the model the right, which is how the
	 * editor is arranged -- the same object in the same place whether you are
	 * reading about it or writing it.
	 *
	 * The markup keeps the model first, since that is the narrow order, and
	 * the columns are placed explicitly rather than reordered with `order`,
	 * so the two are not fighting over the same cell. 768px is where the rest
	 * of the site already switches.
	 */
	.build-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/*
	 * Wide: if the host gives this a height, it is used -- the model's frame
	 * and the tab column stretch to it, and the open tab scrolls inside its
	 * own panel. A host that sets no height gets the natural size instead,
	 * so nothing here assumes one. The 100% chain is what makes a fixed fold
	 * possible: object-view, the grid, and both columns each pass the height
	 * down, with min-height: 0 so a long source cannot push it open again.
	 */
	@media (min-width: 768px) {
		.object-view {
			height: 100%;
		}
		.build-panel {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
			grid-template-rows: minmax(0, 1fr);
			gap: 2rem;
			height: 100%;
		}
		.viewer {
			grid-area: 1 / 2;
			aspect-ratio: auto;
			min-height: 0;
		}
		.side {
			grid-area: 1 / 1;
			min-height: 0;
		}
		.tab-body {
			flex: 1 1 auto;
			min-height: 0;
			overflow-y: auto;
		}
	}
	.side {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/*
	 * The model scrolls with the page.
	 *
	 * It was sticky for a while, to keep it in view while a long description
	 * or a long source went past underneath. What that actually bought was a
	 * permanently shrunken model taking the top of a phone screen, which is
	 * the wrong trade: reading wants the room, and looking wants the model
	 * bigger than a third of the viewport, not smaller.
	 */
	.viewer {
		aspect-ratio: 16 / 10;
		background: #f7fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}
	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #718096;
		font-size: 0.9rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid #e2e8f0;
	}
	.tab {
		appearance: none;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
		color: #4a5568;
		cursor: pointer;
	}
	.tab:hover {
		color: #2d3748;
	}
	.tab.active {
		color: #2b6cb0;
		border-bottom-color: #2b6cb0;
		font-weight: 600;
	}
	.tab-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0 1.25rem;
	}
	/* `display` here outranks the `[hidden] { display: none }` every browser
	   ships, so without this the inactive panels stay on screen and the tabs
	   look broken. */
	.tab-body[hidden] {
		display: none;
	}
	.formats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.format {
		padding: 0.5rem 1.1rem;
		border: 1px solid #cbd5e0;
		border-radius: 6px;
		background: #fff;
		font-size: 0.9rem;
		font-weight: 600;
		color: #2d3748;
		cursor: pointer;
	}
	.format:hover:not(:disabled) {
		border-color: #2b6cb0;
		background: #ebf8ff;
	}
	.format:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.empty {
		font-size: 0.85rem;
		color: #718096;
		margin: 0;
	}
	.source {
		margin: 0;
		padding: 0.75rem;
		background: #f7fafc;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		font-size: 0.8rem;
		line-height: 1.5;
		/* Only sideways: the page scrolls vertically and the model stays in
		   view while it does, so a second vertical scrollbar here would only
		   be somewhere for a finger to get stuck. */
		overflow-x: auto;
	}
	.source code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		white-space: pre;
	}
</style>
