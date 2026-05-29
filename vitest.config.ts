import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { globals: false },
  resolve: {
    alias: { vscode: path.resolve(__dirname, 'src/test/__mocks__/vscode.ts') }
  }
});
