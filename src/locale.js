import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import crypto from 'node:crypto';

const LOCALE_EXTENSIONS = new Set(['.js', '.mjs', '.ts']);

function localeFromFilename(fileName) {
	return path.basename(fileName, path.extname(fileName));
}

function normalizeLocale(locale) {
	const normalized = String(locale || '').trim().replaceAll('_', '-').toLowerCase();
	const aliases = {
		english: 'en',
		arabic: 'ar',
		french: 'fr',
		spanish: 'es',
		german: 'de',
		portuguese: 'pt',
		italian: 'it',
		japanese: 'ja',
		korean: 'ko',
		chinese: 'zh'
	};
	return aliases[normalized] || normalized;
}

function findLocale(locales, requestedLocale, fallbackLocale) {
	const requested = normalizeLocale(requestedLocale);
	const exact = locales.find(locale => normalizeLocale(locale) === requested);
	if (exact) return exact;

	const language = requested.split('-')[0];
	const languageMatch = locales.find(locale => normalizeLocale(locale).split('-')[0] === language);
	if (languageMatch) return languageMatch;

	return fallbackLocale;
}

function readMessage(messages, key) {
	return key.split('.').reduce((value, part) => value?.[part], messages);
}

function interpolate(message, values) {
	return message.replace(/\{(\w+)\}/g, (_, name) => {
		return values[name] === undefined ? `{${name}}` : String(values[name]);
	});
}

function parseAcceptLanguage(header) {
	return String(header || '')
		.split(',')
		.map(value => {
			const [tag, qVal] = value.split(';').map(s => s.trim());
			let q = 1;
			if (qVal && qVal.startsWith('q=')) {
				const parsedQ = parseFloat(qVal.slice(2));
				if (!isNaN(parsedQ)) q = parsedQ;
			}
			return { tag, q };
		})
		.filter(item => item.tag && item.q > 0)
		.sort((a, b) => b.q - a.q)
		.map(item => item.tag);
}

/**
 * Loads translation files from the application's locale directory.
 * Each file name becomes a locale, for example locale/en-US.js.
 * @param {string} directory
 * @param {{ defaultLocale?: string }} [options]
 */
export async function loadLocale(directory, options = {}) {
	const files = fs.existsSync(directory)
		? fs.readdirSync(directory).filter(file => {
			const fullPath = path.join(directory, file);
			return fs.statSync(fullPath).isFile() && LOCALE_EXTENSIONS.has(path.extname(file));
		})
		: [];

	const messages = {};
	for (const file of files) {
		const module = await import(`${pathToFileURL(path.join(directory, file)).href}?update=${crypto.randomUUID()}`);
		const catalog = module.default || module.messages || module;
		if (catalog && typeof catalog === 'object') {
			messages[localeFromFilename(file)] = catalog;
		}
	}

	const locales = Object.keys(messages);
	const configuredDefault = options.defaultLocale;
	const defaultLocale = findLocale(locales, configuredDefault, null)
		|| locales.find(locale => ['en', 'en-us'].includes(normalizeLocale(locale)))
		|| locales[0]
		|| 'en';

	function resolveLocale(request) {
		const requestedLocales = parseAcceptLanguage(request?.headers?.['accept-language']);
		for (const requested of requestedLocales) {
			const match = findLocale(locales, requested, null);
			if (match) return match;
		}
		return defaultLocale;
	}

	function translate(locale, key, values = {}) {
		const selectedLocale = findLocale(locales, locale, defaultLocale);
		const message = readMessage(messages[selectedLocale], key)
			?? readMessage(messages[defaultLocale], key);

		if (message === undefined) return key;
		if (typeof message !== 'string') return message;
		return interpolate(message, values);
	}

	return { locales, defaultLocale, resolveLocale, translate };
}