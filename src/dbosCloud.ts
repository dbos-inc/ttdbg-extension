import * as vscode from 'vscode';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { logger } from './extension';
import { sleep } from './utils';

interface CloudOptions {
  cloudDomain: string;
  loginDomain: string;
  clientId: string;
  audience: string;
}

function getCloudOptions(host?: string): CloudOptions {
  const cloudDomain = host ?? "cloud.dbos.dev";
  const production = cloudDomain === "cloud.dbos.dev";
  const loginDomain = production ? 'login.dbos.dev' : 'dbos-inc.us.auth0.com';
  const clientId = production ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
  const audience = 'dbos-cloud-api';
  return { cloudDomain, loginDomain, clientId, audience };
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

async function getDeviceCode(options: CloudOptions, token?: vscode.CancellationToken) {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    const url = `https://${options.loginDomain}/oauth/device/code`;
    const request = <RequestInit>{
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: abort.signal,
      body: new URLSearchParams({
        client_id: options.clientId,
        scope: 'sub',
        audience: options.audience
      })
    };
    const response = await fetch(url, request);
    const json = await response.json();
    logger.debug("getDeviceCode", json);
    return json as DeviceCodeResponse;
  } finally {
    tokenListener?.dispose();
  }
}

interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getAuthToken(deviceCodeResponse: DeviceCodeResponse, options: CloudOptions, token?: vscode.CancellationToken) {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    const url = `https://${options.loginDomain}/oauth/token`;
    const request = <RequestInit>{
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: abort.signal,
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCodeResponse.device_code,
        client_id: options.clientId
      })
    };
    let elapsedTimeSec = 0;
    while (elapsedTimeSec < deviceCodeResponse.expires_in) {
      if (token?.isCancellationRequested) { return undefined; }
      await sleep(deviceCodeResponse.interval * 1000);
      elapsedTimeSec += deviceCodeResponse.interval;
      if (token?.isCancellationRequested) { return undefined; }

      const response = await fetch(url, request);
      if (response.ok) {
        const json = await response.json();
        logger.debug("getAuthToken", json);
        return json as AuthTokenResponse;
      } else if (response.status === 403) {
        // 403 response means the user hasn't logged in yet, so we should keep polling
        logger.debug("getAuthToken", { status: response.status, statusText: response.statusText });
      } else {
        throw new Error(`getAuthToken oauth/token request failed: ${response.status} ${response.statusText}`);
      }
    }
    return undefined;
  } finally {
    tokenListener?.dispose();
  }
}

async function verifyToken(token: string, options: CloudOptions): Promise<JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw new Error('Invalid token');
  }

  const client = jwksClient({ jwksUri: `https://${options.loginDomain}/.well-known/jwks.json` });
  const key = await client.getSigningKey(decoded.header.kid);
  const signingKey = key.getPublicKey();

  return await new Promise<JwtPayload>((resolve, reject) => {
    jwt.verify(token, signingKey, { algorithms: ['RS256'] }, (err, verifiedToken) => {
      if (err) {
        reject(err);
      } else {
        resolve(verifiedToken as JwtPayload);
      }
    });
  });
}

async function dbosLogin(accessToken: string, options: CloudOptions, token?: vscode.CancellationToken) {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {

    const url = `https://${options.cloudDomain}/v1alpha1/user`;
    const request = <RequestInit>{
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${accessToken}`
      },
      signal: abort.signal,
    };
    const response = await fetch(url, request);
    return await response.text();
  } finally {
    tokenListener?.dispose();
  }
}

async function authenticate() {
  const options = getCloudOptions();
  const deviceCode = await getDeviceCode(options);
  logger.info("authenticate.getDeviceCode", deviceCode);
  const authToken = await getAuthToken(deviceCode, options);
  logger.info("authenticate.getAuthToken", authToken);
  if (!authToken) { return undefined; }
  const decoded = await verifyToken(authToken.access_token, options);


  const userName = await dbosLogin(authToken.access_token, options);
  logger.info("authenticate.dbosLogin", { userName });
  return { authToken, userName };
}

export async function foo() {
  try {
    const token = await authenticate();
    logger.info("foo", token);
  } catch (e) {
    logger.error("foo", e);
  }
}
