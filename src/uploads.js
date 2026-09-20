import crypto from 'crypto';

/**
 * Secure Upload Pipeline for bro.js
 * Provides streaming abstractions and adapters for object storage.
 */

export class SecureUploadPipeline {
  constructor(config = {}) {
    this.adapters = config.adapters || {};
    this.defaultAdapter = config.defaultAdapter || 'local';
    this.maxSize = config.maxSize || 50 * 1024 * 1024; // 50MB default
    this.allowedMimeTypes = config.allowedMimeTypes || ['image/jpeg', 'image/png', 'application/pdf'];
  }

  async processUpload(file, options = {}) {
    this._validateFile(file, options);
    
    const adapterName = options.adapter || this.defaultAdapter;
    const adapter = this.adapters[adapterName];
    
    if (!adapter) {
      throw new Error(`Upload adapter '${adapterName}' not found.`);
    }

    const key = crypto.randomUUID() + '-' + file.originalname;
    const url = await adapter.upload(key, file.buffer || file.stream(), file.mimetype);
    
    return { key, url, size: file.size, mimetype: file.mimetype };
  }

  _validateFile(file, options) {
    const size = file.size;
    const maxSize = options.maxSize || this.maxSize;
    if (size > maxSize) {
      throw new Error(`File size ${size} exceeds quota of ${maxSize} bytes.`);
    }

    const mime = file.mimetype || file.type;
    const allowed = options.allowedMimeTypes || this.allowedMimeTypes;
    if (allowed !== '*' && !allowed.includes(mime)) {
      throw new Error(`MIME type ${mime} is not allowed.`);
    }
  }

  async getSignedUrl(key, adapterName = this.defaultAdapter, expiresIn = 3600) {
    const adapter = this.adapters[adapterName];
    if (!adapter || typeof adapter.getSignedUrl !== 'function') {
      throw new Error(`Adapter '${adapterName}' does not support signed URLs.`);
    }
    return await adapter.getSignedUrl(key, expiresIn);
  }
}

/**
 * Example Local Storage Adapter
 */
import fs from 'fs';
import path from 'path';

export class LocalStorageAdapter {
  constructor(uploadDir) {
    this.uploadDir = uploadDir || path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async save(fileStream, originalName, mimeType) {
    const fileName = `${Date.now()}-${originalName}`;
    const filePath = path.join(this.uploadDir, fileName);
    const writeStream = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      fileStream.pipe(writeStream);
      fileStream.on('end', resolve);
      fileStream.on('error', reject);
    });
    return { url: `/uploads/${fileName}`, id: fileName, path: filePath };
  }

  async delete(id) {
    const filePath = path.join(this.uploadDir, id);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
}

export class S3StorageAdapter {
  constructor(config) {
    this.config = config;
  }

  async save(fileStream, originalName, mimeType) {
    let AWS;
    try {
      AWS = await import('@aws-sdk/client-s3');
    } catch (e) {
      throw new Error('Please install @aws-sdk/client-s3 to use S3StorageAdapter');
    }
    const { S3Client } = AWS;
    const { Upload } = await import('@aws-sdk/lib-storage');
    
    const client = new S3Client(this.config);
    const key = `${Date.now()}-${originalName}`;
    
    const upload = new Upload({
      client,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: fileStream,
        ContentType: mimeType
      }
    });

    const result = await upload.done();
    return { url: result.Location, id: key };
  }
  
  async delete(id) {
    let AWS = await import('@aws-sdk/client-s3');
    const client = new AWS.S3Client(this.config);
    await client.send(new AWS.DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: id
    }));
  }
}