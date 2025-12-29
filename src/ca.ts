import http from 'node:http';
import 'dotenv/config';
import { generateKeyPair, signCertificate } from './cryptoUtils.js';

console.log('[CA] Generating Root Keys...');
const { publicKey: CA_PUBLIC_KEY, privateKey: CA_PRIVATE_KEY } = generateKeyPair();

console.log('[CA] Root Authority Online.');
console.log(`[CA] Public Key Fingerprint: ${CA_PUBLIC_KEY.slice(27, 60)}...`);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') return res.end('Only POST allowed');

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);

      if (req.url === '/sign') {
        const { id, publicKey } = payload;
        console.log(`[CA] Signing certificate for Node ${id}`);

        const certData = {
          subject: id,
          issuer: 'RootCA',
          publicKey: publicKey,
        };

        const signature = signCertificate(certData, CA_PRIVATE_KEY);

        const certificate = { ...certData, signature };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ certificate, caPublicKey: CA_PUBLIC_KEY }));
      }
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end('Error');
    }
  });
});

server.listen(process.env.CA_PORT, () => {
  console.log(`[CA] Listening on http://localhost:${process.env.CA_PORT}`);
});
