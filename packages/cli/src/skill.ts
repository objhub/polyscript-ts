/**
 * `poly skill` -- put the modelling skill where an AI coding agent will find it.
 *
 * The skill is a set of markdown files that teach an agent to write PolyScript
 * and, more importantly, to check what it built without a person looking at
 * the result. They ship inside this binary (see skill-data.ts), so installing
 * needs no network and the instructions can never describe a `poly` that is
 * not the one installed.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { SKILL_FILES, SKILL_LOCALES } from './skill-data.js';
// Same source as index.ts: bun inlines it, so the compiled binary needs no
// file at runtime.
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;

/**
 * Where each agent looks for skills.
 *
 * All three read the same `SKILL.md` -- name and description in the
 * frontmatter, instructions in the body -- so one set of files serves them
 * all. Only the directory differs, and Copilot reads two of the others', so
 * `--target claude` alone already covers it.
 *
 * Verified against each vendor's documentation, 2026-09-26.
 */
export type Target = 'claude' | 'codex' | 'copilot';

interface Layout {
	/** Relative to the project, for a repository-local install. */
	project: string;
	/** Relative to $HOME, for an install that applies everywhere. */
	user: string;
	/** Which other agents read the same directory. */
	alsoRead: string[];
}

const LAYOUTS: Record<Target, Layout> = {
	// Claude Code. Copilot also reads .claude/skills, so this covers both.
	claude: {
		project: join('.claude', 'skills', 'poly'),
		user: join('.claude', 'skills', 'poly'),
		alsoRead: ['GitHub Copilot']
	},
	// Codex CLI. Copilot reads .agents/skills too.
	codex: {
		project: join('.agents', 'skills', 'poly'),
		user: join('.agents', 'skills', 'poly'),
		alsoRead: ['GitHub Copilot']
	},
	// Copilot's own directory, for anyone who would rather keep it separate.
	copilot: {
		project: join('.github', 'skills', 'poly'),
		user: join('.copilot', 'skills', 'poly'),
		alsoRead: []
	}
};

export function installRoot(target: Target, global: boolean, cwd: string): string {
	const l = LAYOUTS[target];
	return global ? join(homedir(), l.user) : join(cwd, l.project);
}

function write(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

/** Stamp the version in, so `poly skill list` can say what is out of date. */
function stamped(text: string): string {
	return text.replace(/^---\n/, `---\n# installed by poly ${VERSION}\n`);
}

/** The languages this binary carries a vocabulary for. */
export function locales(): string[] {
	return Object.keys(SKILL_LOCALES).sort();
}

/**
 * Which language to install the vocabulary in.
 *
 * Read from the environment, because the person who set `LANG=ja_JP.UTF-8` has
 * already said what they speak and should not have to say it again. Falls back
 * to English, which every carried locale can be compared against.
 */
export function defaultLocale(env: NodeJS.ProcessEnv = process.env): string {
	const tag = (env.LC_ALL || env.LC_MESSAGES || env.LANG || '').split(/[._@]/)[0];
	const lang = tag.toLowerCase().replace('_', '-').split('-')[0];
	return lang in SKILL_LOCALES ? lang : 'en';
}

export interface InstallResult {
	root: string;
	locale: string;
	files: string[];
	alsoRead: string[];
}

export function install(
	target: Target,
	global: boolean,
	cwd: string,
	locale: string,
): InstallResult {
	const root = installRoot(target, global, cwd);
	const files: string[] = [];

	// The shared half, then the chosen language. A locale file lands on the
	// same path whichever language it is, so SKILL.md names one file and does
	// not have to know which was installed.
	for (const [rel, text] of Object.entries(SKILL_FILES)) {
		write(join(root, rel), rel === 'SKILL.md' ? stamped(text) : text);
		files.push(rel);
	}
	for (const [rel, text] of Object.entries(SKILL_LOCALES[locale] ?? {})) {
		write(join(root, rel), text);
		files.push(rel);
	}
	return { root, locale, files, alsoRead: LAYOUTS[target].alsoRead };
}

/** What is installed where, and whether it matches this binary. */
export function list(cwd: string): { path: string; version: string; current: boolean }[] {
	const out: { path: string; version: string; current: boolean }[] = [];
	const seen = new Set<string>();
	for (const target of Object.keys(LAYOUTS) as Target[]) {
		for (const global of [false, true]) {
			const skill = join(installRoot(target, global, cwd), 'SKILL.md');
			if (seen.has(skill) || !existsSync(skill)) continue;
			seen.add(skill);
			const m = readFileSync(skill, 'utf8').match(/^# installed by poly (\S+)$/m);
			const version = m ? m[1] : 'unknown';
			out.push({ path: skill, version, current: version === VERSION });
		}
	}
	return out;
}
