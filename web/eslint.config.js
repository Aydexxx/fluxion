import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // A registry of ~15 per-node-type form components plus the lookup helpers
    // that index them; splitting each into its own file (as the rule suggests)
    // would scatter a single cohesive concern across many tiny files for no
    // real benefit here, so fast-refresh granularity is knowingly traded away.
    files: ['**/configForms.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
