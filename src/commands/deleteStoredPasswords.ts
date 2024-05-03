import { logger, config } from '../extension';

export async function deleteStoredPasswords() {
  logger.debug("deleteStoredPasswords");
  try {
    await config.deletePasswords();
  } catch (e) {
    logger.error("deleteProvenanceDatabasePasswords", e);
  }
}
