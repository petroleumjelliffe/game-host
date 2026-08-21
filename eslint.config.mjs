// One ESLint invocation covers all seven workspaces: typescript-eslint's
// `projectService` resolves each file to its own package's tsconfig.json, so
// there is no --workspaces fan-out here and there should not be one. 386
// files, type-aware, in about five seconds.
//
// Five rules, all errors, each one measured against this repo rather than
// inherited from a preset. `strictTypeChecked` reports ~1,500 findings here
// (911 of them no-non-null-assertion) and oxlint's defaults report 146, of
// which 95 are one false positive on the `then:` key of our golden fixtures.
// A gate nobody trusts is a gate nobody runs. See
// docs/plans/2026-08-20-the-linter.md for the full ledger — including the
// part worth remembering, that this gate found no defects when it landed.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Built output, coverage, and Acquire's static design prototype — the
    // last is hand-written demo HTML/JS that was never part of the app.
    //
    // Plain JavaScript is ignored outright rather than left to ESLint's
    // defaults. Nothing here defines rules for .js, so the only thing it
    // could ever report is an unused disable directive — and it did, on
    // games/acquire/scripts/sw.template.js, whose `/* eslint-disable
    // no-undef */` is entirely correct for a service worker's globals and
    // reads as unused only because no-undef is not on. A gate that scolds
    // correct code is the thing this config is trying not to be.
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'games/acquire/prototype/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  {
    // Type-aware rules need types, so this block is TypeScript only. The
    // .mjs build and tooling scripts are deliberately unlinted: they would
    // need a default project, and they are not where the risk is.
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: {
          // TypeScript that belongs to no tsconfig, and so is not typechecked
          // either. Marco Polo's two config files: Rail Baron and Acquire
          // both list vite.config.ts in their `include` and Marco Polo lists
          // neither; adding them surfaces two pre-existing type errors in
          // vitest.config.ts and is its own change (see docs/backlog.md).
          // Acquire's generate-manifest.ts: a prebuild step run by tsx, in a
          // scripts/ directory no `include` covers. Both get the default
          // project so they are linted at all, rather than being ignored for
          // the crime of not being in a tsconfig.
          allowDefaultProject: [
            'games/marcopolo/*.config.ts',
            'games/acquire/scripts/*.ts',
          ],
        },
      },
    },
    linterOptions: {
      // The reverse of the problem this repo already had: two disable
      // comments outlived the plugin they named and silently suppressed
      // nothing for months. A stale suppression is a lie in the source.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // The rule this gate exists for: the next unawaited store write.
      //
      // react-router 7 types NavigateFunction as `void | Promise<void>`
      // because navigation in a data router is async, so every navigate()
      // call in all three clients reads as a floating promise — 29 of them,
      // none a defect. Naming the type here keeps the rule sharp for the
      // calls that matter instead of training everyone to ignore it.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'react-router', name: 'NavigateFunction' },
          ],
        },
      ],
      // `checksVoidReturn.attributes` off: an async onClick is ordinary React
      // and flagging it says nothing useful. The other checksVoidReturn
      // cases — an async function passed where void is required — stay on.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Cheap, and catches `await` on a value that was never a promise —
      // usually a signature that changed underneath the caller.
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    // The three clients are all React. rules-of-hooks reports nothing today
    // and is pure insurance; exhaustive-deps found four things, all of them
    // this codebase's deliberate change-token pattern — a `key` in the array
    // standing in for the derived data it was computed from. Kept as an
    // error rather than a warning so each one has to say so out loud: a
    // warning tier here would just be a list nobody reads.
    files: ['**/*.tsx', '**/src/**/*.ts', '**/client/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
