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

    async getCredential(
        domain?: string | DbosCloudDomain,
        refreshInvalid: boolean = false,
    ): Promise<DbosCloudCredential | undefined> {
        logger.debug("getCredential", { domain: domain ?? null, refreshInvalid });

        const cred = await this.#getCloudCredential(domain);
        if (CloudCredentialManager.isCredentialValid(cred)) { 
            return cred; 
        }
        if (refreshInvalid) {
            this.#startInvalidCredentialFlow(domain, cred);
        }
    }

    async #startInvalidCredentialFlow(
        domain: string | DbosCloudDomain | undefined, 
        credential: DbosCloudCredential| undefined
    ): Promise<void> {
        try {
            const message = credential
                ? "DBOS Cloud credentials have expired. Please login again."
                : "You need to login to DBOS Cloud.";

            const items = ["Login", "Cancel"];
            const result = await vscode.window.showWarningMessage(message, ...items);
            if (result === "Login") {
                await this.#cloudLogin(domain);
            }
        } catch (error) {
            logger.error("startInvalidCredentialsFlow", error);
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
            const credentials = await that.getCredential(domain);
            if (CloudCredentialManager.isCredentialValid(credentials)) {
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
