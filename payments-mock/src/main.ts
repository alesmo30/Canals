import { buildServer } from './server';

const PORT = 4000;
const HOST = '0.0.0.0';

const app = buildServer();

app.listen({ port: PORT, host: HOST }, (error) => {
  if (error) {
    // eslint-disable-next-line no-console -- payments-mock has no card data reaching this line, and no redacting logger of its own (it is a standalone mock, not part of the main app).
    console.error(error);
    process.exit(1);
  }
});
