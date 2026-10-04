const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const stream = require('stream');
const { promisify } = require('util');

const pipeline = promisify(stream.pipeline);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || 'mjm-returns-evidence';

async function uploadEvidenceFile(localPath, r2Key, contentType = 'image/jpeg') {
  const fileStream = fs.createReadStream(localPath);
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: r2Key,
    Body: fileStream,
    ContentType: contentType,
  });
  await r2.send(command);
  return r2Key;
}

async function downloadEvidenceFile(r2Key, destLocalPath) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: r2Key,
  });
  const response = await r2.send(command);
  await pipeline(response.Body, fs.createWriteStream(destLocalPath));
  return destLocalPath;
}

module.exports = {
  uploadEvidenceFile,
  downloadEvidenceFile,
};