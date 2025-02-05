import * as vscode from 'vscode';
import jwt from 'jsonwebtoken';
import { DbosCloudDomain, DbosCloudCredential, getCloudDomain, authenticate } from './dbosCloudApi';
import { logger } from './extension';

export class CloudCredentialManager {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    static #domainSecretKey(domain: string) {
        return `dbos-ttdbg:domain:${domain}`;
    }

    static isCredentialValid(credential?: DbosCloudCredential): boolean {
        if (!credential) { return false; }
        try {
            const { exp } = jwt.decode(credential.token) as jwt.JwtPayload;
            if (!exp) { return false; }
            return Date.now() < exp * 1000;
        } catch (error) {
            return false;
        }
    }

    async getStoredCredential(domain?: string | DbosCloudDomain): Promise<DbosCloudCredential | undefined> {
        const { cloudDomain } = getCloudDomain(domain);
        const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
        const json = await this.secrets.get(secretKey);
        return json ? JSON.parse(json) as DbosCloudCredential : undefined;
    }

    async #cloudLogin(domain?: string | DbosCloudDomain) {
        const { cloudDomain } = getCloudDomain(domain);
        const credential = await authenticate(cloudDomain);
        if (credential) {
            const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
            await this.secrets.store(secretKey, JSON.stringify(credential));
        }
        return credential;
    }

    async getCredential(domain?: string | DbosCloudDomain) {
        const { cloudDomain } = getCloudDomain(domain);
        const storedCredentials = await this.getStoredCredential(cloudDomain);
        return CloudCredentialManager.isCredentialValid(storedCredentials)
            ? storedCredentials
            : await this.#cloudLogin(cloudDomain);
    }

    async #deleteStoredCredential(domain?: string | DbosCloudDomain) {
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

    // async #startInvalidCredentialsFlow(credentials?: DbosCloudCredentials): Promise<void> {
    //     try {
    //         const message = credentials
    //             ? "DBOS Cloud credentials have expired. Please login again."
    //             : "You need to login to DBOS Cloud.";

    //         const items = ["Login", "Cancel"];
    //         const result = await vscode.window.showWarningMessage(message, ...items);
    //         if (result === "Login") {
    //             await this.#cloudLogin();
    //         }
    //     } catch (error) {
    //         logger.error("startInvalidCredentialsFlow", error);
    //     }
    // }

    // validateCredentials(credentials?: DbosCloudCredentials): credentials is DbosCloudCredentials {
    //     if (!credentials || CloudCredentialManager.#isTokenExpired(credentials.token)) {
    //         this.#startInvalidCredentialsFlow(credentials);
    //         return false;
    //     }

    //     return true;
    // }

    getCloudLoginCommand(refresh: (domain: string) => Promise<void>) {
        const that = this;
        return async function (node?: { domain: string }) {
            logger.debug("cloudLogin", { domain: node ?? null });

            const domain = node?.domain;
            if (!domain) { return; }
            const credentials = await that.getStoredCredential(domain);
            if (CloudCredentialManager.isCredentialValid(credentials)) {
                const message = "You are already logged in. Do you want to refresh your credential?";
                const items = ["Yes", "No"];
                const result = await vscode.window.showWarningMessage(message, ...items);
                if (result !== "Yes") {
                    return;
                }
            }

            if (await that.getCredential()) {
                await refresh(domain);
            }
        };
    }

    getDeleteStoredCredentialsCommand(refresh: (domain: string) => Promise<void>) {
        const that = this;
        return async function (node?: { domain: string }) {
            logger.debug("deleteStoredCredentials", { domain: node ?? null });
            const domain = node?.domain;
            if (!domain) { return; }
            await that.#deleteStoredCredential(domain);
            await refresh(domain);
        };
    }
}
