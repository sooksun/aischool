// Real lint gate (2026-07-18 audit fix): the root/CI `lint` script self-arms off
// workspace `lint` scripts — until this file existed, no workspace defined one
// and the CI gate passed green having linted nothing. Scope: correctness
// (typescript-eslint recommended), hooks discipline (react-hooks), and the
// accessibility conventions this app already follows by hand (jsx-a11y) — no
// stylistic/formatting rules, which stay out of scope per the audit follow-up.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: ['dist/**', 'src/api/schema.generated.ts'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // The generated-client pattern needs `as` casts at the unwrap boundary and
      // test mocks; `any` stays banned everywhere else via the recommended set.
      '@typescript-eslint/no-explicit-any': 'error',
      // Every data page uses the classic fetch-on-mount pattern (reset loading
      // state synchronously, then fetch) — this new-in-v6 rule flags all of them.
      // Deliberately off until those pages migrate to the cancelled-async-effect
      // pattern as their own refactor; rules-of-hooks and exhaustive-deps (the
      // audit's actual gap) remain enforced above.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
