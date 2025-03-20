# Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Prerequisites

- Node.js 22 or later
- Redis server (or use Docker Compose)

## Development

This project uses TypeScript and Node.js. To get started, follow these steps:

1. Clone the repository:

   ```sh
   git clone https://github.com/hasura/engine-plugin-rate-limit.git
   cd engine-plugin-rate-limit
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Build the project:

   ```sh
   npm run build
   ```

4. Start the redis (if you don't have a redis server installed), please skip to step 5 if you have a redis server installed and running:

   ```sh
   docker compose up redis
   ```

5. Copy the sample configuration files to the `config` directory:

   ```sh
   cp sample_config/* config/
   ```

   Change the redis url in the `rate-limit.json` file to `redis://localhost:6379` (or the url of your redis server)

6. Start the development server with debug logs in another terminal:
   ```sh
   DEBUG=rate-limit* node dist/index.js
   ```

## Testing

To run the tests, use the following command:

```sh
npm test
```

Please make sure that you have redis running before running the tests.

You can also use the `scripts/test-rate-limit.sh` script to simulate rate limiting in dev.

```sh
./scripts/test-rate-limit.sh 2000 0.5
```

This will send 2000 requests with a 0.5s delay between each request.

## Linting and Formatting

This project uses Prettier for code formatting. To check formatting, run:

```sh
npm run lint
```

To automatically format your code, run:

```sh
npm run format
```
