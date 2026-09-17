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
);
