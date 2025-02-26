import * as vscode from 'vscode';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { logger } from './extension';

export type Unauthorized = { status: "unauthorized" };

export function isUnauthorized(obj: any): obj is Unauthorized {
  return obj?.status === "unauthorized";
}

export interface DbosCloudCredential {
  token: string;
  userName: string;
  domain: string;
}

export interface DbosCloudApp {
  Name: string;
  ID: string;
  PostgresInstanceName: string;
  ApplicationDatabaseName: string;
  Status: string;
  Version: string;
  AppURL: string;
  ProvenanceDatabase?: {
    HostName: string;
    Name: string;
    Port: number;
  };
}

export interface DbosCloudDbInstance {
  PostgresInstanceName: string;
  HostName: string;
  Status: string;
  Port: number;
  DatabaseUsername: string;
  // AdminUsername: string;
}

export interface DbosCloudDbProxyRole {
  RoleName: string;
  Secret: string;
}

export interface DbosCloudDbCredentials {
  RoleName: string;
	Password: string;
}

export interface DbosCloudDomain {
  cloudDomain: string;
  loginDomain: string;
  clientId: string;
}

export function getCloudDomain(domain?: string | DbosCloudDomain): DbosCloudDomain {
  if (typeof domain === 'object') { return domain; }
  const cloudDomain = domain ?? "cloud.dbos.dev";
  const isProduction = cloudDomain === "cloud.dbos.dev";
  const loginDomain = isProduction ? 'login.dbos.dev' : 'dbos-inc.us.auth0.com';
  // spell-checker: disable-next-line
  const clientId = isProduction ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
  return { cloudDomain, loginDomain, clientId };
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

async function getDeviceCode(domain?: string | DbosCloudDomain, token?: vscode.CancellationToken): Promise<DeviceCodeResponse> {
  const { loginDomain, clientId } = getCloudDomain(domain);
  const url = `https://${loginDomain}/oauth/device/code`;
  const request = <RequestInit>{
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'sub',
      audience: 'dbos-cloud-api'
    })
  };

  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`getDeviceCode request failed`, {
      cause: { url, clientId, status: response.status, statusText: response.statusText }
    });
  }

  const body = (await response.json()) as DeviceCodeResponse;
  logger.debug("getDeviceCode", { url, status: response.status, body });
  return body;
}

interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getAuthToken(deviceCodeResponse: DeviceCodeResponse, domain?: string | DbosCloudDomain, token?: vscode.CancellationToken): Promise<AuthTokenResponse | undefined> {
  const { loginDomain, clientId } = getCloudDomain(domain);
  const { device_code, user_code, expires_in, interval } = deviceCodeResponse;
  const url = `https://${loginDomain}/oauth/token`;
  const requestBody = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: device_code,
    client_id: clientId
  });
  const request = <RequestInit>{
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: requestBody
  };

  logger.debug("getAuthToken starting", { url, deviceCodeResponse, domain: domain ?? null, requestBody: [...requestBody] });

  let elapsedTimeSec = 0;
  while (elapsedTimeSec < expires_in) {
    if (token?.isCancellationRequested) {
      logger.debug("getAuthToken cancelled", { url, user_code });
      return undefined;
    }

    await new Promise((r) => setTimeout(r, interval * 1000));
    elapsedTimeSec += interval;
    const response = await cancellableFetch(url, request, token);

    if (response.ok) {
      const body = await response.json() as AuthTokenResponse;
      logger.debug("getAuthToken", { url, user_code, status: response.status, body });
      return body;
    } else if (response.status === 403) {
      // 403 response means the user hasn't logged in yet, so keep polling
      logger.debug("getAuthToken", { url, user_code, requestBody, status: response.status });
    } else {
      throw new Error(`getAuthToken request failed`, {
        cause: { url, user_code, status: response.status, statusText: response.statusText }
      });
    }
  }

  logger.debug("getAuthToken timed out", { url, user_code });
  return undefined;
}

export async function verifyToken(authToken: string | AuthTokenResponse, domain?: string | DbosCloudDomain, token?: vscode.CancellationToken): Promise<JwtPayload> {
  const $authToken = typeof authToken === 'string' ? authToken : authToken.access_token;

  const decoded = jwt.decode($authToken, { complete: true });
  if (!decoded || !decoded.header.kid) { throw new Error('Invalid token'); }

  const { loginDomain } = getCloudDomain(domain);
  const client = jwksClient({ jwksUri: `https://${loginDomain}/.well-known/jwks.json` });
  const key = await client.getSigningKey(decoded.header.kid);
  const signingKey = key.getPublicKey();

  const payload = await new Promise<JwtPayload>((resolve, reject) => {
    token?.onCancellationRequested(() => reject(new Error('Cancelled')));
    jwt.verify($authToken, signingKey, { algorithms: ['RS256'] }, (err, verifiedToken) => {
      if (err) {
        reject(err);
      } else {
        resolve(verifiedToken as JwtPayload);
      }
    });
  });
  logger.debug("verifyToken", { domain, authToken, payload });

  return payload;
}

export async function authenticate(domain?: string | DbosCloudDomain): Promise<DbosCloudCredential | undefined> {
  try {
    const cloud = getCloudDomain(domain);
    const result = await vscode.window.withProgress({
      cancellable: true,
      location: vscode.ProgressLocation.Notification,
      title: `Log into DBOS Cloud`
    }, async (progress, token) => {
      // create a new CTS so we can cancel the progress window if openExternal call fails
      const cts = new vscode.CancellationTokenSource();
      try {
        // cancel the constructed CTS if the provided token requests cancellation
        token.onCancellationRequested(() => cts.cancel());

        const deviceCodeResponse = await getDeviceCode(cloud, cts.token);
        progress.report({ message: `User code ${deviceCodeResponse.user_code}` });

        vscode.env.openExternal(vscode.Uri.parse(deviceCodeResponse.verification_uri_complete))
          .then(result => {
            if (!result) {
              logger.error("authenticate.openExternal", { result });
              cts.cancel();
            }
          }, e => {
            // cancel the constructed CTS if openExternal call fails
            logger.error("authenticate.openExternal", e);
            cts.cancel();
          });

        const authTokenResponse = await getAuthToken(deviceCodeResponse, cloud, cts.token);
        if (!authTokenResponse) { return undefined; }

        const access_token = authTokenResponse.access_token;
        await verifyToken(access_token, cloud, cts.token);
        const userName = await getUser(access_token, cloud, cts.token);
        const credentials = <DbosCloudCredential>{ token: access_token, userName, domain: cloud.cloudDomain };
        return credentials;
      } finally {
        cts.dispose();
      }
    });
    logger.debug("authenticate", result);
    return result;
  } catch (e) {
    logger.error("authenticate", e);
    return undefined;
  }
}

async function getUser(accessToken: string, domain?: string | DbosCloudDomain, token?: vscode.CancellationToken) {
  const { cloudDomain } = getCloudDomain(domain);
  const url = `https://${cloudDomain}/v1alpha1/user`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };
  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`getUser request failed`, {
      cause: { url, accessToken, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.text();
  logger.debug("getUser", { url, authToken: accessToken, status: response.status, body });
  return body;
}

export async function listApps({ domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<Unauthorized | DbosCloudApp[]> {
  const url = `https://${domain}/v1alpha1/${userName}/applications`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('listApps', url, request, async (response) => await response.json() as DbosCloudApp[], token);
}

export async function getApp(appName: string, { domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<Unauthorized | DbosCloudApp> {
  const url = `https://${domain}/v1alpha1/${userName}/applications/${appName}`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('getApp', url, request, async (response) => await response.json() as DbosCloudApp, token);
}

export async function listDbInstances({ domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<Unauthorized | DbosCloudDbInstance[]> {
  const url = `https://${domain}/v1alpha1/${userName}/databases`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('listDbInstances', url, request, async (response) => await response.json() as DbosCloudDbInstance[], token);
}

export async function getDbInstance(dbName: string, { domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<Unauthorized | DbosCloudDbInstance> {
  const url = `https://${domain}/v1alpha1/${userName}/databases/userdb/info/${dbName}`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('getDbInstance', url, request, async (response) => await response.json() as DbosCloudDbInstance, token);
}

export async function getDbProxyRole(dbName: string, { domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<Unauthorized | DbosCloudDbProxyRole> {
  const url = `https://${domain}/v1alpha1/${userName}/databases/userdb/${dbName}/proxyrole`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('getDbProxyRole', url, request, async (response) => await response.json() as DbosCloudDbProxyRole, token);
}


export async function getDbCredentials(dbName: string, { domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<Unauthorized | DbosCloudDbCredentials> {
  const url = `https://${domain}/v1alpha1/${userName}/databases/userdb/${dbName}/credentials`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('getDbCredentials', url, request, async (response) => await response.json() as DbosCloudDbCredentials, token);
}

export async function createDashboard({ domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<string | Unauthorized> {

  const url = `https://${domain}/v1alpha1/${userName}/dashboard`;
  const request = <RequestInit>{
    method: 'PUT',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };

  return fetchHelper('createDashboard', url, request, (response) => response.text(), token);
}

export async function getDashboard({ domain, token: accessToken, userName }: DbosCloudCredential, token?: vscode.CancellationToken): Promise<string | Unauthorized | undefined> {
  const url = `https://${domain}/v1alpha1/${userName}/dashboard`;
  const request = <RequestInit>{
    method: 'GET',
    headers: { 'authorization': `Bearer ${accessToken}` }
  };
  const response = await cancellableFetch(url, request, token);
  logger.debug("getDashboard", { url, status: response.status });
  if (response.ok || response.status === 500) {
    const body = response.ok ? await response.text() : undefined;;
    logger.debug("getDashboard", { body: body ?? null });
    return body;
  } else if (response.status === 401) {
    return <Unauthorized>{ status: "unauthorized" };
  } else {
    throw new Error(`getDashboard request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }
}

async function fetchHelper<T>(name: string, url: string, request: Omit<RequestInit, 'signal'>, onOk: (resp: Response) => Promise<T>, token?: vscode.CancellationToken): Promise<T | Unauthorized> {
  const response = await cancellableFetch(url, request, token);
  logger.debug(name, { url, status: response.status });
  if (response.ok) {
    const body = await onOk(response);
    logger.debug(name, { body });
    return body;
  } else if (response.status === 401) {
    return { status: "unauthorized" };
  } else {
    throw new Error(`${name} request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }
}

async function cancellableFetch(url: string, request: Omit<RequestInit, 'signal'>, token?: vscode.CancellationToken) {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    return await fetch(url, { ...request, signal: abort.signal });
  } finally {
    tokenListener?.dispose();
  }
}
