import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
try { await access('.env'); console.log('.env already exists; existing credentials are unchanged.'); }
catch {
  await writeFile('.env', `APP_ORIGIN=http://localhost:4173
ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}
SESSION_SECRET=${randomBytes(32).toString('hex')}
DATABASE_URL=postgres://catalog:local-catalog@localhost:5432/catalog
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=catalog
S3_ACCESS_KEY_ID=catalog-${randomBytes(8).toString('hex')}
S3_SECRET_ACCESS_KEY=${randomBytes(24).toString('base64url')}
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=http://localhost:9000/catalog
`, { flag:'wx', mode:0o600 });
  console.log('Created .env with random credentials. Admin password: ADMIN_PASSWORD in .env (not printed).');
}
console.log('Next: docker compose up --build -d');
