import { logger, config } from '../extension';


export const deleteStoredPasswordsCommandName = "dbos-ttdbg.delete-stored-passwords";
export async function deleteStoredPasswords() {
  logger.debug("deleteStoredPasswords");
  try {
    await config.deletePasswords();
  } catch (e) {
    logger.error("deleteProvenanceDatabasePasswords", e);
  }
}
