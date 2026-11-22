import { S3Client, PutObjectCommand, HeadObjectCommand, CreateBucketCommand, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { put, head } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { getPool } from './db.mjs';
export const maxImageSize = 8 * 1024 * 1024;
export const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export function driver() { return process.env.STORAGE_DRIVER || 's3'; }
export function s3(publicEndpoint = false) {
  return new S3Client({ region: process.env.S3_REGION || 'us-east-1',
    endpoint: (publicEndpoint ? process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT : process.env.S3_ENDPOINT) || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    // Presigning an empty command must not attach the checksum of an empty file
    // to a later browser PUT containing the actual image.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
}
export function mediaUrl(key) {
  if (!process.env.S3_PUBLIC_URL) throw new Error('S3_PUBLIC_URL is not configured');
  return `${process.env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}
export async function rememberMedia(key, url, type, size) {
  await getPool().query('INSERT INTO media(object_key,url,content_type,size_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(object_key) DO UPDATE SET url=EXCLUDED.url,content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes', [key, url, type, size]);
  return url;
}
export async function signedUpload(key, type, size) {
  return getSignedUrl(s3(true), new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: type, ContentLength: size }), { expiresIn: 300 });
}
export async function finishUpload(key) {
  if (!/^images\/[a-f0-9-]+\.(jpg|png|webp)$/.test(key)) throw Object.assign(new Error('Некорректный ключ изображения.'), { status: 400 });
  const meta = await s3().send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  if (!imageTypes[meta.ContentType] || !meta.ContentLength || meta.ContentLength > maxImageSize) throw Object.assign(new Error('Некорректный размер или тип изображения.'), { status: 400 });
  return rememberMedia(key, mediaUrl(key), meta.ContentType, meta.ContentLength);
}
export async function importImage(bytes, type) {
  const key = `images/${createHash('sha256').update(bytes).digest('hex')}.${imageTypes[type]}`;
  const known = await getPool().query('SELECT url FROM media WHERE object_key=$1', [key]);
  if (known.rows[0]) return known.rows[0].url;
  let url;
  if (driver() === 'blob') url = (await put(key, bytes, { access: 'public', contentType: type, addRandomSuffix: false })).url;
  else {
    await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: bytes, ContentType: type }));
    url = mediaUrl(key);
  }
  return rememberMedia(key, url, type, bytes.length);
}
export async function confirmBlob(url) {
  // SDK head validates that this URL belongs to the configured Blob store.
  const info = await head(url);
  if (!imageTypes[info.contentType] || info.size > maxImageSize) throw Object.assign(new Error('Некорректное изображение.'), { status: 400 });
  return rememberMedia(info.pathname, info.url, info.contentType, info.size);
}
export async function initialiseLocalStorage() {
  if (process.env.LOCAL_STORAGE_INIT !== 'true') return;
  const client = s3(); const bucket = process.env.S3_BUCKET;
  for (let attempt = 0; ; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket })); break;
    } catch (error) {
      if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) break;
      if (attempt >= 25) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }] }) }));
  // MinIO configures CORS globally via MINIO_API_CORS_ALLOW_ORIGIN in Compose;
  // the S3 Bucket CORS API is not implemented by MinIO.
}
