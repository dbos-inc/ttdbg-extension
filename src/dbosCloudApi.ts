import * as vscode from 'vscode';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { logger } from './extension';
import { sleep } from './utils';

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
  const { loginDomain: domain, clientId } = getCloudOptions(host);
  const url = `https://${domain}/oauth/device/code`;
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
  if (!response.ok) { throw new Error(`getDeviceCode request failed: ${response.status} ${response.statusText}`); }
  const body = (await response.json()) as DeviceCodeResponse;
  logger.debug("getDeviceCode", { domain, status: response.status, body });
  return body;
}

interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getAuthToken(deviceCode: DeviceCodeResponse, host: CloudHost, token?: vscode.CancellationToken): Promise<AuthTokenResponse | undefined> {
  const { loginDomain: domain, clientId } = getCloudOptions(host);
  const url = `https://${domain}/oauth/token`;
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
      logger.debug("getAuthToken cancelled", { domain, deviceCode });
      return undefined;
    }

    await sleep(deviceCode.interval * 1000);
    elapsedTimeSec += deviceCode.interval;
    const response = await cancellableFetch(url, request, token);

    if (response.ok) {
      const body = await response.json() as AuthTokenResponse;
      logger.debug("getAuthToken", { domain, deviceCode, status: response.status, body });
      return body;
    } else if (response.status === 403) {
      // 403 response means the user hasn't logged in yet, so keep polling
      logger.debug("getAuthToken", { domain, deviceCode, status: response.status });
    } else {
      throw new Error(`getAuthToken oauth/token request failed: ${response.status} ${response.statusText}`, { cause: { loginDomain: domain, deviceCode, status: response.status } });
    }
  }
  logger.debug("getAuthToken timed out", { domain, deviceCode });
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
  const { cloudDomain: domain } = getCloudOptions(host);
  const url = `https://${domain}/v1alpha1/user`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(authToken)
  };
  const response = await cancellableFetch(url, request, token);
  const body = await response.text();
  logger.debug("GET dbos-cloud/user", { domain, authToken, status: response.status, body });
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
  if (!response.ok) { throw new Error(`${domain}/${userName}/applications request failed: ${response.status} ${response.statusText}`); }
  const body = await response.json() as DbosCloudApp[];
  logger.debug("GET dbos-cloud/<user>/applications", { domain, userName, status: response.status, body });
  return body;
}

export async function getAppInfo(appName: string, { domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/applications/${appName}`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };
  const response = await cancellableFetch(url, request, token);
  if (!response.ok) { throw new Error(`${domain}/${userName}/applications/${appName} request failed: ${response.status} ${response.statusText}`); }
  const body = await response.json() as DbosCloudApp;
  logger.debug("GET dbos-cloud/<user>/applications/<app>", { domain, userName, appName, status: response.status, body });
  return body;
}

export async function listDatabases({ domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/databases`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };
  const response = await cancellableFetch(url, request, token);
  if (!response.ok) { throw new Error(`${domain}/${userName}/databases request failed: ${response.status} ${response.statusText}`); }
  const body = await response.json() as DbosCloudDatabase[];
  logger.debug("GET dbos-cloud/<user>/applications", { domain, userName, status: response.status, body });
  return body;
}

export async function getDatabaseInfo(dbName: string, { domain, token: accessToken, userName }: DbosCloudCredentials, token?: vscode.CancellationToken) {
  const url = `https://${domain}/v1alpha1/${userName}/databases/userdb/info/${dbName}`;
  const request = <RequestInit>{
    method: 'GET',
    headers: authHeaders(accessToken)
  };
  const response = await cancellableFetch(url, request, token);
  if (!response.ok) { throw new Error(`${domain}/${userName}/databases/${dbName} request failed: ${response.status} ${response.statusText}`); }
  const body = await response.json() as DbosCloudDatabase;
  logger.debug("GET dbos-cloud/<user>/databases/<db>", { domain, userName, dbName, status: response.status, body });
  return body;
}