import * as vscode from 'vscode';
import jwt from 'jsonwebtoken';
import { DbosCloudDomain, DbosCloudCredentials, getCloudDomain, authenticate } from './dbosCloudApi';
import { logger } from './extension';

export class CloudCredentialManager {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    static #domainSecretKey(domain: string) {
        return `dbos-ttdbg:domain:${domain}`;
    }

    static #isTokenExpired(authToken: string): boolean {
        try {
            const { exp } = jwt.decode(authToken) as jwt.JwtPayload;
            if (!exp) { return false; }
            return Date.now() >= exp * 1000;
        } catch (error) {
            return true;
        }
    }

    async #getStoredCloudCredentials(domain?: string | DbosCloudDomain): Promise<DbosCloudCredentials | undefined> {
        const { cloudDomain } = getCloudDomain(domain);
        const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
        const json = await this.secrets.get(secretKey);
        return json ? JSON.parse(json) as DbosCloudCredentials : undefined;
    }

    async #cloudLogin(domain?: string | DbosCloudDomain) {
        const { cloudDomain } = getCloudDomain(domain);
        const credentials = await authenticate(cloudDomain);
        if (credentials) {
            const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
            await this.secrets.store(secretKey, JSON.stringify(credentials));
        }
        return credentials;
    }

    async getCredentials(domain?: string | DbosCloudDomain) {
        const { cloudDomain } = getCloudDomain(domain);
        const storedCredentials = await this.#getStoredCloudCredentials(cloudDomain);
        if (storedCredentials && !CloudCredentialManager.#isTokenExpired(storedCredentials.token)) {
            return storedCredentials;
        }
        return await this.#cloudLogin(cloudDomain);
    }

    async #deleteStoredCloudCredentials(domain?: string | DbosCloudDomain) {
        const { cloudDomain } = getCloudDomain(domain);
        const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
        const json = await this.secrets.get(secretKey);
        if (json) {
            await this.secrets.delete(secretKey);
            logger.debug("Deleted DBOS Cloud credentials", { cloudDomain });
            return true;
        } else {
            return false;
        }
    }

    async #startInvalidCredentialsFlow(credentials?: DbosCloudCredentials): Promise<void> {
        try {
            const message = credentials
                ? "DBOS Cloud credentials have expired. Please login again."
                : "You need to login to DBOS Cloud.";

            const items = ["Login", "Cancel"];
            const result = await vscode.window.showWarningMessage(message, ...items);
            if (result === "Login") {
                await this.#cloudLogin();
            }
        } catch (error) {
            logger.error("startInvalidCredentialsFlow", error);
        }
    }

    validateCredentials(credentials?: DbosCloudCredentials): credentials is DbosCloudCredentials {
        if (!credentials || CloudCredentialManager.#isTokenExpired(credentials.token)) {
            this.#startInvalidCredentialsFlow(credentials);
            return false;
        }

        return true;
    }
}
