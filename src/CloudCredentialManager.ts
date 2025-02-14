import * as vscode from 'vscode';
import jwt from 'jsonwebtoken';
import { DbosCloudDomain, DbosCloudCredential, getCloudDomain, authenticate } from './dbosCloudApi';
import { logger } from './extension';

export class CloudCredentialManager implements vscode.Disposable {
    private readonly onCredentialChangeEmitter = new vscode.EventEmitter<string>();

    readonly onCredentialChange = this.onCredentialChangeEmitter.event;

    constructor(private readonly secrets: vscode.SecretStorage, private readonly memento: vscode.Memento) { }

    dispose() {
        this.onCredentialChangeEmitter.dispose();
    }

    static #domainSecretKey(domain: string) {
        return `dbos-ttdbg:domain:${domain}`;
    }

    async #getCloudCredential(domain: string | DbosCloudDomain | undefined): Promise<DbosCloudCredential | undefined> {
        const { cloudDomain } = getCloudDomain(domain);
        const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
        const json = await this.secrets.get(secretKey);
        return json ? JSON.parse(json) as DbosCloudCredential : undefined;
    }

    async #storeCloudCredential(cred: DbosCloudCredential, domain: string | DbosCloudDomain | undefined): Promise<void> {
        const { cloudDomain } = getCloudDomain(domain);
        const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
        const json = JSON.stringify(cred);
        await this.secrets.store(secretKey, json);
        this.onCredentialChangeEmitter.fire(cloudDomain);
    }

    async #deleteCloudCredential(domain: string | DbosCloudDomain | undefined): Promise<void> {
        const { cloudDomain } = getCloudDomain(domain);
        const secretKey = CloudCredentialManager.#domainSecretKey(cloudDomain);
        await this.secrets.delete(secretKey);
        this.onCredentialChangeEmitter.fire(cloudDomain);
    }

    static isCredentialValid(credential?: DbosCloudCredential): boolean {
        if (!credential) { return false; }
        try {
            const { exp } = jwt.decode(credential.token) as jwt.JwtPayload;
            return exp ? Date.now() < exp * 1000 : false;
        } catch (error) {
            return false;
        }
    }

    async getCachedCredential(domain?: string | DbosCloudDomain): Promise<DbosCloudCredential | undefined> {
        logger.debug("getCredential", { domain: domain ?? null });
        return await this.#getCloudCredential(domain);
    }

    async getValidCredential(domain?: string | DbosCloudDomain): Promise<DbosCloudCredential | undefined> {
        logger.debug("getCredential", { domain: domain ?? null });

        const cred = await this.#getCloudCredential(domain);
        if (cred && CloudCredentialManager.isCredentialValid(cred)) {
            return cred;
        }
    }

    async updateCredential(domain?: string | DbosCloudDomain, credential?: DbosCloudCredential): Promise<DbosCloudCredential | undefined> {
        logger.debug("updateCredential", { domain: domain ?? null, credential: credential ?? null });
        if (credential && CloudCredentialManager.isCredentialValid(credential)) {
            return credential;
        }

        try {
            const message = credential
                ? "Your DBOS Cloud credentials have expired. Please login again."
                : "Please login to DBOS Cloud.";
            const result = await vscode.window.showInformationMessage(message, "Login", "Cancel");
            if (result === "Login") {
                return await this.#cloudLogin(domain);
            }
        } catch (error) {
            logger.error("updateCredential", error);
        }
    }

    async #cloudLogin(domain: string | DbosCloudDomain | undefined) {
        const cloud = getCloudDomain(domain);
        const credential = await authenticate(cloud);
        if (credential) {
            await this.#storeCloudCredential(credential, cloud);
        }
        return credential;
    }

    getCloudLoginCommand() {
        const that = this;
        return async function (node?: { domain: string }) {
            logger.debug("cloudLogin", { domain: node?.domain ?? null });

            const domain = getCloudDomain(node?.domain);
            const cred = await that.getValidCredential(domain);
            if (cred) {
                const message = "You are already logged in. Do you want to refresh your credential?";
                const items = ["Yes", "No"];
                const result = await vscode.window.showWarningMessage(message, ...items);
                if (result !== "Yes") {
                    return;
                }
            }

            await that.#cloudLogin(domain);
        };
    }

    getDeleteCloudCredentialsCommand() {
        const that = this;
        return async function (node?: { domain: string }) {
            logger.debug("deleteCloudCredentials", { domain: node?.domain ?? null });
            await that.#deleteCloudCredential(node?.domain);
        };
    }
}
