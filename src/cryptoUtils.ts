import crypto from 'node:crypto';

export function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function signCertificate<T>(data: T, caPrivateKey: string): string {
  const sign = crypto.createSign('SHA256');
  sign.update(JSON.stringify(data));
  sign.end();
  return sign.sign(caPrivateKey, 'base64');
}

export function verifySignature<T>(data: T, signature: string, caPublicKey: string): boolean {
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

export function symmetricEncrypt(text: string, keyHex: string): { iv: string; content: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(keyHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    content: encrypted,
    authTag: authTag.toString('hex'),
  };
}

export function symmetricDecrypt(encrypted: { iv: string; content: string; authTag: string }, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted.content, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
