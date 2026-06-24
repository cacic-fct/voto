import { waitForPortOpen } from '@nx/node/utils';

module.exports = async function () {
  console.log('\nSetting up...\n');

  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const retries = process.env.E2E_WAIT_RETRIES ? Number(process.env.E2E_WAIT_RETRIES) : 10;
  const retryDelay = process.env.E2E_WAIT_RETRY_DELAY_MS ? Number(process.env.E2E_WAIT_RETRY_DELAY_MS) : 1000;

  await waitForPortOpen(port, { host, retries, retryDelay });
};
