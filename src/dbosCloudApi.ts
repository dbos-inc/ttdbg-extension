import * as vscode from 'vscode';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { logger } from './extension';

export interface DbosCloudCredentials {
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
}

export interface DbosCloudDatabase {
  PostgresInstanceName: string;
  HostName: string;
  Status: string;
  Port: number;
  DatabaseUsername: string;
  AdminUsername: string;
}

interface CloudOptions {
  cloudDomain: string;
  loginDomain: string;
  clientId: string;
}

type CloudHost = string | CloudOptions | undefined;

export function getCloudOptions(host?: CloudHost): CloudOptions {
  if (typeof host === 'object') { return host; }
  const cloudDomain = host ?? "cloud.dbos.dev";
  const isProduction = cloudDomain === "cloud.dbos.dev";
  const loginDomain = isProduction ? 'login.dbos.dev' : 'dbos-inc.us.auth0.com';
  const clientId = isProduction ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
  return { cloudDomain, loginDomain, clientId };
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

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

async function getDeviceCode(host: CloudHost, token?: vscode.CancellationToken): Promise<DeviceCodeResponse> {
  const { loginDomain, clientId } = getCloudOptions(host);
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
    throw new Error(`POST <loginDomain>/oauth/device/code request failed`, {
      cause: { url, clientId, status: response.status, statusText: response.statusText }
    });
  }

  const body = (await response.json()) as DeviceCodeResponse;
  logger.debug("POST <loginDomain>/oauth/device/code", { url, status: response.status, body });
  return body;
}

interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getAuthToken(deviceCode: DeviceCodeResponse, host: CloudHost, token?: vscode.CancellationToken): Promise<AuthTokenResponse | undefined> {
  const { loginDomain, clientId } = getCloudOptions(host);
  const url = `https://${loginDomain}/oauth/token`;
  const request = <RequestInit>{
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode.device_code,
      client_id: clientId
    })
  };

  let elapsedTimeSec = 0;
  while (elapsedTimeSec < deviceCode.expires_in) {
    if (token?.isCancellationRequested) {
      logger.debug("POST <loginDomain>/oauth/token cancelled", { url, deviceCode });
      return undefined;
    }

    await sleep(deviceCode.interval * 1000);
    elapsedTimeSec += deviceCode.interval;
    const response = await cancellableFetch(url, request, token);

    if (response.ok) {
      const body = await response.json() as AuthTokenResponse;
      logger.debug("POST <loginDomain>/oauth/token", { url, deviceCode, status: response.status, body });
      return body;
    } else if (response.status === 403) {
      // 403 response means the user hasn't logged in yet, so keep polling
      logger.debug("POST <loginDomain>/oauth/token", { url, deviceCode, status: response.status });
    } else {
      throw new Error(`POST <loginDomain>/oauth/token request failed`, {
        cause: { url, deviceCode, status: response.status, statusText: response.statusText }
      });
    }
  }
  logger.debug("getAuthToken timed out", { url, deviceCode });
  return undefined;
}

export function isTokenExpired(authToken: string | AuthTokenResponse): boolean {
  const $authToken = typeof authToken === 'string' ? authToken : authToken.access_token;
  try {
    const { exp } = jwt.decode($authToken) as jwt.JwtPayload;
    if (!exp) { return false; }
    return Date.now() >= exp * 1000;
  } catch (error) {
    return true;
  }
}

export function isPayloadExpired(payload: JwtPayload): boolean {
  const { exp } = payload;
  if (!exp) { return false; }
  return Date.now() >= exp * 1000;
}

export async function verifyToken(authToken: string | AuthTokenResponse, host: CloudHost, token?: vscode.CancellationToken): Promise<JwtPayload> {
  const $authToken = typeof authToken === 'string' ? authToken : authToken.access_token;

  const decoded = jwt.decode($authToken, { complete: true });
  if (!decoded || !decoded.header.kid) { throw new Error('Invalid token'); }

  const { loginDomain: domain } = getCloudOptions(host);
  const client = jwksClient({ jwksUri: `https://${domain}/.well-known/jwks.json` });
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

function authHeaders(authToken: string | AuthTokenResponse) {
  const $authToken = typeof authToken === 'string' ? authToken : authToken.access_token;
  return { 'authorization': `Bearer ${$authToken}` };
}

async function getUser(authToken: string | AuthTokenResponse, host: CloudHost, token?: vscode.CancellationToken) {
  const { cloudDomain } = getCloudOptions(host);
  const url = `https://${cloudDomain}/v1alpha1/user`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(authToken)
  };
  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`GET <cloudDomain>/user request failed`, {
      cause: { url, authToken, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.text();
  logger.debug("GET dbos-cloud/user", { url, authToken, status: response.status, body });
  return body;
}

export async function authenticate(host?: CloudHost): Promise<DbosCloudCredentials | undefined> {
  try {
    const cloud = getCloudOptions(host);
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
        const credentials = <DbosCloudCredentials>{ token: access_token, userName, domain: cloud.cloudDomain };
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

export async function listApps({ domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/applications`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };

  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`GET <cloudDomain>/<user>/applications request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.json() as DbosCloudApp[];
  logger.debug("GET <cloudDomain>/user/applications", { url, status: response.status, body });
  return body;
}

export async function getAppInfo(appName: string, { domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/applications/${appName}`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };

  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`GET <cloudDomain>/<user>/applications/<app> request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.json() as DbosCloudApp;
  logger.debug("GET <cloudDomain>/<user>/applications/<app>", { url, status: response.status, body });
  return body;
}

export async function listDatabases({ domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/databases`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };

  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`GET <cloudDomain>/<user>/databases request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.json() as DbosCloudDatabase[];
  logger.debug("GET <cloudDomain>/<user>/databases", { url, status: response.status, body });
  return body;
}

export async function getDatabaseInfo(dbName: string, { domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/databases/userdb/info/${dbName}`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };

  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`GET <cloudDomain>/<user>/databases/userdb/info/<db> request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.json() as DbosCloudDatabase;
  logger.debug("GET <cloudDomain>/<user>/databases/userdb/info/<db> ", { url, status: response.status, body });
  return body;
}

export async function launchDashboard({ domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {

  const url = `https://${domain}/v1alpha1/${userName}/dashboard`;
  const request = <RequestInit>{
    method: 'PUT',
    headers: authHeaders(accessToken)
  };

  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`PUT <cloudDomain>/<user>/dashboard request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }
  const body = await response.text();
  logger.debug("PUT dbos-cloud/<user>/dashboard", { url, status: response.status, body });
  return body;
}

export async function getDashboard({ domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/dashboard`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };
  const response = await cancellableFetch(url, request, token);
  if (!response.ok) {
    throw new Error(`GET <cloudDomain>/<user>/dashboard request failed`, {
      cause: { url, status: response.status, statusText: response.statusText }
    });
  }

  const body = await response.text();
  logger.debug("GET <cloudDomain>/<user>/dashboard", { url, status: response.status, body });
  return body;
}