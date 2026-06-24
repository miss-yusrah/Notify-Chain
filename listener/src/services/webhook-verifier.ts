import crypto from 'crypto';
import { WebhookSecret } from '../types';

const SIGNATURE_PREFIX = 'sha256=';

export function verifySignature(payload: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  const providedSig = signatureHeader.slice(SIGNATURE_PREFIX.length);

  if (expectedSig.length !== providedSig.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expectedSig, 'utf8'), Buffer.from(providedSig, 'utf8'));
}

export function extractSignature(headers: Record<string, string | string[] | undefined>): string | null {
  const sigHeader = headers['x-webhook-signature'] ?? headers['X-Webhook-Signature'];
  if (!sigHeader) return null;
  return Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
}

export function extractKeyId(headers: Record<string, string | string[] | undefined>): string | null {
  const keyId = headers['x-webhook-key-id'] ?? headers['X-Webhook-Key-Id'];
  if (!keyId) return null;
  return Array.isArray(keyId) ? keyId[0] : keyId;
}

export function getSecretForKey(secrets: WebhookSecret[], keyId: string): string | undefined {
  return secrets.find((s) => s.id === keyId)?.secret;
}

export function collectRawBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
