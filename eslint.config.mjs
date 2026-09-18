// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // R0.2 (frozen contract): src/domain/** is pure TypeScript with no
    // framework or persistence dependencies, and it must not reach into
    // infrastructure — it depends on ports, not adapters.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'typeorm',
              message: 'src/domain must stay framework-free: no typeorm imports.',
            },
          ],
          patterns: [
            {
              group: ['@nestjs/*', '@nestjs/**'],
              message: 'src/domain must stay framework-free: no @nestjs/* imports.',
            },
            {
              group: [
                '@infrastructure/*',
                '@infrastructure/**',
                '*infrastructure*',
                '**/infrastructure/*',
                '**/infrastructure/**',
              ],
              message:
                'src/domain must not import src/infrastructure — depend on ports (src/domain/ports), not adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    // specs/02-fulfilment-core.md (Scope, R1.5, Decisions): reserve/release/
    // commit and the failover loop run inside a database transaction and
    // must never make a network call while holding row locks. The barrier
    // goes up before P4 brings a payment gateway into the codebase.
    files: ['src/application/allocation/**/*.ts', 'src/infrastructure/database/repositories/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message: 'Reservation/allocation code must stay network-free: no HTTP clients while holding row locks.',
            },
            {
              name: 'node-fetch',
              message: 'Reservation/allocation code must stay network-free: no HTTP clients while holding row locks.',
            },
            {
              name: 'undici',
              message: 'Reservation/allocation code must stay network-free: no HTTP clients while holding row locks.',
            },
            {
              name: '@nestjs/axios',
              message: 'Reservation/allocation code must stay network-free: no HTTP clients while holding row locks.',
            },
            {
              name: 'http',
              message: 'Reservation/allocation code must stay network-free: no HTTP clients while holding row locks.',
            },
            {
              name: 'https',
              message: 'Reservation/allocation code must stay network-free: no HTTP clients while holding row locks.',
            },
          ],
        },
      ],
    },
  },
);
