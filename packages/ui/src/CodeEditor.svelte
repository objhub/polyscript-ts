<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorState, type Extension } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
	import { searchKeymap } from '@codemirror/search';
	import { acceptCompletion, completionKeymap } from '@codemirror/autocomplete';

	interface Props {
		value: string;
		onchange?: (value: string) => void;
		extensions?: Extension[];
		theme?: Record<string, any>;
	}

	let { value, onchange, extensions = [], theme = {} }: Props = $props();

	let container: HTMLDivElement;
	let view: EditorView | undefined;

	onMount(() => {
		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				onchange?.(update.state.doc.toString());
			}
		});

		const defaultTheme: Record<string, any> = {
			'&': { height: '100%', fontSize: '13px' },
			'.cm-scroller': { overflow: 'auto' },
			'.cm-content': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }
		};

		const state = EditorState.create({
			doc: value,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				history(),
				bracketMatching(),
				syntaxHighlighting(defaultHighlightStyle),
				keymap.of([
					{ key: 'Tab', run: acceptCompletion },
					...defaultKeymap,
					...historyKeymap,
					...searchKeymap,
					...completionKeymap
				]),
				...extensions,
				updateListener,
				EditorView.theme({ ...defaultTheme, ...theme })
			]
		});

		view = new EditorView({ state, parent: container });
	});

	onDestroy(() => {
		view?.destroy();
	});

	$effect(() => {
		if (view && value !== view.state.doc.toString()) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value }
			});
		}
	});

	export function getView(): EditorView | undefined {
		return view;
	}
</script>

<div class="editor" bind:this={container}></div>

<style>
	.editor {
		width: 100%;
		height: 100%;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		overflow: hidden;
		background: #fff;
	}
</style>
