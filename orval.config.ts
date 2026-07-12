import { defineConfig } from 'orval';

const input = './contracts/generated/search-api.openapi.json';

export default defineConfig({
  gatewayClient: {
    input: { target: input },
    output: {
      mode: 'split',
      client: 'fetch',
      target: './src/generated/gateway/client.ts',
      schemas: './src/generated/models',
      mock: true,
      clean: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: true
        }
      }
    }
  },
  gatewayZod: {
    input: { target: input },
    output: {
      mode: 'single',
      client: 'zod',
      target: './src/generated/gateway.zod.ts',
      clean: false
    }
  }
});
