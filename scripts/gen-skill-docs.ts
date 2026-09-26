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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
		.replace(/\[([^\]]+)\]\(\.\.\/cli\/\)/g, '`poly --help`')
		.replace(/\[([^\]]+)\]\(\.\.\/language\/[^)]*\)/g, '$1 (`references/language/index.md`)')
		// Any other site-relative link: keep the words, drop the target.
		.replace(/\[([^\]]+)\]\(\.\.\/[^)]*\)/g, '$1');
	return `# ${title}\n\n> ${note}\n\n${body.trimStart()}`;
}

const NOTE = (src: string) =>
	`GENERATED from docs/content/${src} -- do not edit.\n> Change the docs page, then run: bun scripts/gen-skill-docs.ts`;

const planned: { path: string; text: string }[] = [];

// ---------------------------------------------------------------------------
// The language reference, split for lookup
// ---------------------------------------------------------------------------

/**
 * The docs' language page in pieces, with an index. The cheatsheet says what
 * exists; this says how it works, and an agent reads only the piece it needs
 * -- the @param section is about 700 tokens, the whole page about 10k.
 * English: the same content costs a third fewer tokens than the Japanese.
 *
 *   - a `##` section up to SPLIT_ABOVE characters is one file;
 *   - a larger one (Primitives, Pipe Operations) is one file per `###`,
 *     its own intro going to the first;
 *   - pieces under TINY characters are pooled: small `##` sections into
 *     basics.md, a small `###` into its next sibling.
 */
const LANGUAGE = { lang: 'en', page: 'language.md', dir: 'references/language' };
const SPLIT_ABOVE = 4000;
const TINY = 600;

const slug = (title: string) =>
	title.replace(/`/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Split markdown at a heading level, fence-aware; [heading, body][]. */
function sections(md: string, level: 2 | 3): { head: string; body: string }[] {
	const marker = `${'#'.repeat(level)} `;
	const out: { head: string; body: string }[] = [{ head: '', body: '' }];
	let fenced = false;
	for (const line of md.split('\n')) {
		if (line.startsWith('```')) fenced = !fenced;
		if (!fenced && line.startsWith(marker)) out.push({ head: line.slice(marker.length).trim(), body: '' });
		out[out.length - 1].body += `${line}\n`;
	}
	return out;
}

/** The first prose line of a piece (outside code), for the index. */
function gist(body: string): string {
	let fenced = false;
	for (const line of body.split('\n')) {
		const t = line.trim();
		if (t.startsWith('```')) {
			fenced = !fenced;
			continue;
		}
		if (fenced || !t || t.startsWith('#') || t.startsWith('|') || t.startsWith('>')) continue;
		return t.length > 110 ? `${t.slice(0, 107)}...` : t;
	}
	return '';
}

function planLanguage(): void {
	const src = join(docs, LANGUAGE.lang, LANGUAGE.page);
	if (!existsSync(src)) {
		console.error(`missing: ${src}`);
		process.exit(1);
	}
	const md = readFileSync(src, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '');
	const pieces: { file: string; titles: string[]; body: string }[] = [];
	const basics: { titles: string[]; body: string } = { titles: [], body: '' };

	for (const sec of sections(md, 2)) {
		if (!sec.head) continue; // the page title and anything above the first section
		if (sec.body.length < TINY) {
			basics.titles.push(sec.head);
			basics.body += sec.body;
		} else if (sec.body.length <= SPLIT_ABOVE) {
			// Name the subsections too: "Math Functions" is findable in the
			// index only if the index says it is in expressions.md.
			const subs = sections(sec.body, 3).slice(1).map((x) => x.head);
			const title = subs.length ? `${sec.head} (${subs.join(', ')})` : sec.head;
			pieces.push({ file: slug(sec.head), titles: [title], body: sec.body });
		} else {
			const subs = sections(sec.body, 3);
			const intro = subs.shift()!.body; // "## Heading" and its lead text
			let carry = intro;
			let carryTitles: string[] = [];
			subs.forEach((sub, i) => {
				carry += sub.body;
				carryTitles.push(sub.head);
				if (carry.length < TINY && i < subs.length - 1) return; // pool into the next
				const own = carryTitles.length === subs.length ? '' : `-${slug(carryTitles[0])}`;
				pieces.push({
					file: `${slug(sec.head)}${own}`,
					titles: carryTitles.map((t) => `${sec.head} > ${t}`),
					// Every piece says which section it belongs to.
					body: carry.startsWith('## ') ? carry : `## ${sec.head}\n\n${carry}`,
				});
				carry = '';
				carryTitles = [];
			});
		}
	}
	if (basics.body) pieces.unshift({ file: 'basics', titles: basics.titles, body: basics.body });

	const note = (titles: string[]) =>
		`GENERATED from docs/content/${LANGUAGE.lang}/${LANGUAGE.page} (${titles.join('; ')}) -- do not edit.\n`
		+ `> Change the docs page, then run: bun scripts/gen-skill-docs.ts`;
	for (const piece of pieces) {
		planned.push({
			path: join(skill, LANGUAGE.dir, `${piece.file}.md`),
			text: plain(piece.body, `PolyScript language: ${piece.titles[0].split(' > ')[0].replace(/ \(.*\)$/, '')}`, note(piece.titles)),
		});
	}

	const rows = pieces.map((p) => {
		const tokens = Math.round(p.body.length / 4 / 100) * 100 || 100;
		return `| \`${p.file}.md\` | ${p.titles.map((t) => t.replace(/\|/g, '\\|')).join('<br>')} | ~${tokens} | ${gist(p.body).replace(/\|/g, '\\|')} |`;
	});
	planned.push({
		path: join(skill, LANGUAGE.dir, 'index.md'),
		text: `# PolyScript language reference -- index

> GENERATED from docs/content/${LANGUAGE.lang}/${LANGUAGE.page} -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

The full specification, one file per topic. \`references/cheatsheet.md\` lists
what exists; read the one file below that covers what you need instead of the
whole reference (~${Math.round(md.length / 4 / 1000)}k tokens together). Tokens are approximate.

| File | Covers | Tokens | Starts with |
|---|---|---|---|
${rows.join('\n')}
`,
	});
}



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

planLanguage();

/**
 * What must be written down, and where. The skill carries the cheatsheet and
 * the split language reference; a feature in neither does not exist for the
 * agent -- @param `choices` was on the docs' language page only, which the
 * skill did not carry, and no page listed the built-in functions.
 *
 *   language reference   everything, in full: every keyword, built-in
 *                        function (called), @param option, @param/@profile
 *   cheatsheet           every one of them by name, so the agent knows it
 *                        exists and looks it up in references/language/
 */
function missingTerms(text: string, full: boolean): string[] {
	const has = (term: string) => new RegExp(`(^|[^A-Za-z0-9_])${term.replace(/[@$]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
	return [
		...[...KEYWORDS].filter((k) => !has(k)),
		...Object.keys(BUILTIN_ARITY).filter((f) => !(full ? text.includes(`${f}(`) : has(f))).map((f) => `${f}()`),
		...PARAM_OPTIONS.filter((o) => !text.includes(`\`${o}\``) && !text.includes(`${o}:`)).map((o) => `@param ${o}`),
		...['@param', '@profile'].filter((a) => !has(a)),
	];
}

const cheatsheet = planned.find((p) => p.path.endsWith('references/cheatsheet.md'));
const language = planned.filter((p) => p.path.includes(`/${LANGUAGE.dir}/`)).map((p) => p.text).join('\n');
const missing = [
	...(cheatsheet ? missingTerms(cheatsheet.text, false).map((t) => `cheatsheet: ${t}`) : []),
	...missingTerms(language, true).map((t) => `language reference: ${t}`),
];

if (process.argv.includes('--check')) {
	if (missing.length > 0) {
		console.error(`not documented:\n  ${missing.join('\n  ')}`);
		console.error(`Add them to docs/content/ja/cheatsheet.md (by name) or docs/content/${LANGUAGE.lang}/${LANGUAGE.page} (in full), then run: bun scripts/gen-skill-docs.ts`);
		process.exit(1);
	}
	const langDir = join(skill, LANGUAGE.dir);
	const orphans = existsSync(langDir)
		? readdirSync(langDir).map((f) => join(langDir, f)).filter((f) => !planned.some((p) => p.path === f))
		: [];
	for (const f of orphans) console.error(`orphan (no longer generated): ${f}`);
	if (orphans.length > 0) process.exit(1);
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
	if (missing.length > 0) console.warn(`warning: not documented: ${missing.join(', ')}`);
	// A renamed section must not leave its old file behind in the skill.
	rmSync(join(skill, LANGUAGE.dir), { recursive: true, force: true });
	for (const p of planned) {
		mkdirSync(dirname(p.path), { recursive: true });
		writeFileSync(p.path, p.text);
		console.log(`  ${p.path.slice(skill.length + 1)}`);
	}
}
