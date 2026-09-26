/**
 * Render the docs pages the skill carries.
 *
 * `docs/content/<lang>/` is the source for everything a person could also want
 * to read. The skill's copies differ only in what Hugo needs and an agent does
 * not: frontmatter, and links that resolve only inside the rendered site.
 *
 * Two kinds of page:
 *
 *   shared   one language is enough -- the model reads either, and the cheaper
 *            one wins. Syntax does not change with who is asking.
 *   locale   the words the person used to describe what they want. This is
 *            the part that genuinely has to match them, so every language is
 *            carried and `poly skill install --locale` picks one.
 *
 *   bun scripts/gen-skill-docs.ts          # write the skill's copies
 *   bun scripts/gen-skill-docs.ts --check  # fail if any is stale (CI)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KEYWORDS } from '../packages/core/src/ast.ts';
import { PARAM_OPTIONS } from '../packages/core/src/params.ts';
import { BUILTIN_ARITY } from '../packages/core/src/eval/types.ts';

const root = new URL('..', import.meta.url).pathname;
// docs/ lives in the parent workspace, which a standalone clone of this
// repository does not have. The outputs are committed, so a clone still
// builds; only regeneration needs the sibling checkout.
const docs = join(root, '..', 'docs', 'content');
const skill = join(root, 'skills', 'poly');

/** Pages the skill takes in one language only, and which one. */
const SHARED: { page: string; lang: string; out: string }[] = [
	{ page: 'cheatsheet.md', lang: 'ja', out: 'references/cheatsheet.md' },
];

/** Pages carried in every language, one of which gets installed. */
const LOCALIZED = ['vocabulary.md'];
export const LOCALES = ['ja', 'en'];

/** Strip what only means something inside the rendered site. */
function plain(md: string, title: string, note: string): string {
	const body = md
		.replace(/^---\n[\s\S]*?\n---\n+/, '')
		// Hugo resolves ../foo/ against the page; an agent reading a file
		// cannot. Name the sibling file instead.
		.replace(/\[([^\]]+)\]\(\.\.\/cheatsheet\/\)/g, '`references/cheatsheet.md`')
		.replace(/\[([^\]]+)\]\(\.\.\/cli\/\)/g, '`poly --help`');
	return `# ${title}\n\n> ${note}\n\n${body.trimStart()}`;
}

const NOTE = (src: string) =>
	`GENERATED from docs/content/${src} -- do not edit.\n> Change the docs page, then run: bun scripts/gen-skill-docs.ts`;

const planned: { path: string; text: string }[] = [];

for (const { page, lang, out } of SHARED) {
	const src = join(docs, lang, page);
	if (!existsSync(src)) {
		console.error(`missing: ${src}`);
		process.exit(1);
	}
	const title = page === 'cheatsheet.md' ? 'PolyScript チートシート' : page;
	planned.push({
		path: join(skill, out),
		text: plain(readFileSync(src, 'utf8'), title, NOTE(`${lang}/${page}`)),
	});
}

for (const page of LOCALIZED) {
	for (const lang of LOCALES) {
		const src = join(docs, lang, page);
		if (!existsSync(src)) {
			console.error(`missing: ${src}`);
			process.exit(1);
		}
		planned.push({
			path: join(skill, 'locales', lang, page),
			text: plain(readFileSync(src, 'utf8'), page.replace('.md', ''), NOTE(`${lang}/${page}`)),
		});
	}
}

/**
 * What the cheatsheet must mention. The skill carries this one page, so a
 * feature missing from it does not exist for the agent: `@param` and its
 * `choices` lived only on the docs' language page, and the skill never
 * learned them; neither did it see a single built-in function. Every
 * keyword, every built-in, every @param option, and both annotations.
 */
function missingFromCheatsheet(text: string): string[] {
	const has = (term: string) => new RegExp(`(^|[^A-Za-z0-9_])${term.replace(/[@$]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
	return [
		...[...KEYWORDS].filter((k) => !has(k)),
		...Object.keys(BUILTIN_ARITY).filter((f) => !text.includes(`${f}(`)).map((f) => `${f}()`),
		...PARAM_OPTIONS.filter((o) => !text.includes(`\`${o}\``) && !text.includes(`${o}:`)).map((o) => `@param ${o}`),
		...['@param', '@profile'].filter((a) => !has(a)),
	];
}

const cheatsheet = planned.find((p) => p.path.endsWith('references/cheatsheet.md'));
const missing = cheatsheet ? missingFromCheatsheet(cheatsheet.text) : [];

if (process.argv.includes('--check')) {
	if (missing.length > 0) {
		console.error(`the cheatsheet does not mention: ${missing.join(', ')}`);
		console.error('Add them to docs/content/ja/cheatsheet.md, then run: bun scripts/gen-skill-docs.ts');
		process.exit(1);
	}
	const stale = planned.filter(
		(p) => !existsSync(p.path) || readFileSync(p.path, 'utf8') !== p.text,
	);
	if (stale.length > 0) {
		for (const p of stale) console.error(`stale: ${p.path}`);
		console.error('Run: bun scripts/gen-skill-docs.ts');
		process.exit(1);
	}
	console.log(`skill copies are current (${planned.length} files)`);
} else {
	if (missing.length > 0) console.warn(`warning: the cheatsheet does not mention: ${missing.join(', ')}`);
	for (const p of planned) {
		mkdirSync(dirname(p.path), { recursive: true });
		writeFileSync(p.path, p.text);
		console.log(`  ${p.path.slice(skill.length + 1)}`);
	}
}
