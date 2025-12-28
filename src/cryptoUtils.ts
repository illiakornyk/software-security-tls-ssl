import crypto from 'node:crypto';

export function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function signCertificate(data: any, caPrivateKey: string): string {
  const sign = crypto.createSign('SHA256');
  sign.update(JSON.stringify(data));
  sign.end();
  return sign.sign(caPrivateKey, 'base64');
}

export function verifySignature(data: any, signature: string, caPublicKey: string): boolean {
  const verify = crypto.createVerify('SHA256');
  verify.update(JSON.stringify(data));
  verify.end();
  return verify.verify(caPublicKey, signature, 'base64');
}

export function publicEncrypt(data: string, publicKey: string): string {
  const buffer = Buffer.from(data, 'utf8');
  const encrypted = crypto.publicEncrypt(publicKey, buffer);
  return encrypted.toString('base64');
}

export function privateDecrypt(encryptedBase64: string, privateKey: string): string {
  const buffer = Buffer.from(encryptedBase64, 'base64');
  const decrypted = crypto.privateDecrypt(privateKey, buffer);
  return decrypted.toString('utf8');
}
