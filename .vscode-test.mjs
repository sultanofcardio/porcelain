import { defineConfig } from '@vscode/test-cli';

// Hermetic git for every fixture repo the suite creates: without this, each
// scratch repo inherits the developer's global config — commit signing
// included — and the whole suite fails the moment their signing agent locks.
// Repo-local `git config` in fixtures still works; only the ambient global
// and system layers are cut off.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	mocha: {
		ui: 'bdd',
		// Every test here shells out to git inside a real VS Code, and the ones
		// that drive an interactive rebase spawn several processes in a row.
		// Mocha's 2 s default was tuned for in-process unit tests and the CI
		// runner overran it on its slow days; 10 s is the ceiling the tests
		// that wait on the editor already set for themselves.
		timeout: 10000,
	},
});
