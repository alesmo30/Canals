import { logger } from './logger';
import { buildServer } from './server';

const PORT = 4000;
const HOST = '0.0.0.0';

const app = buildServer();

app.listen(
  { port: PORT, host: HOST },
  (error: Error | null, address: string) => {
    if (error) {
      logger.error(error);
      process.exit(1);
    }
    logger.info({ address }, 'payments-mock.listening');
  },
);
