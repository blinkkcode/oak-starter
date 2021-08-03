import {Pod} from '@oak/oak/dist/src/cms/pod';
import {NunjucksEngine} from '@oak/oak/dist/src/engines/nunjucksengine';
import fetch from 'node-fetch';
import * as nodePath from 'path';
import * as fs from 'fs';

const DEFAULT_BACKEND = 'https://ext-cloud-images-dot-{projectId}.uc.r.appspot.com';

interface CloudImage {
  url: string;
  width?: number;
  height?: number;
}

export class CloudImagesPlugin {
  private pod: Pod;
  private cache: JsonFileCache;
  private backend: string;

  constructor(pod: Pod, options?: {backend?: string}) {
    this.pod = pod;
    this.cache = new JsonFileCache(pod, '/data/cloudimages.json');
    this.backend = options?.backend || pod.podspec.gciBackend;
    if (!this.backend) {
      this.backend = DEFAULT_BACKEND.replace(
        '{projectId}',
        this.pod.podspec.gcpProject
      );
    }

    const nunjucksEngine = this.pod.getEngine('nunjucks') as NunjucksEngine;
    nunjucksEngine.addFilter(
      'cloud_image',
      async (imageData: {url: string}, callback: (err: Error | null, cloudImage: CloudImage | null) => void) => {
        try {
          const cloudImage = await this.getCloudImage(imageData);
          callback(null, cloudImage);
        } catch (e) {
          callback(e, null);
        }
      },
      true /* async */
    );
  }

  async getCloudImage(imageData: {url: string}): Promise<CloudImage> {
    let gcsPath = imageData.url;
    if (gcsPath.startsWith('http')) {
      return imageData;
    }
    if (gcsPath.endsWith('.svg')) {
      return imageData;
    }
    if (gcsPath.startsWith('gs://')) {
      gcsPath = gcsPath.slice(4);
    }
    const cachedData = this.cache.get(gcsPath);
    if (cachedData) {
      const mergedData = Object.assign({}, imageData, cachedData);
      return mergedData;
    }
    console.log(`generating cloud image url for ${gcsPath}`);
    const res = await fetch(`${this.backend}?gs_path=${encodeURIComponent(gcsPath)}`);
    if (res.status !== 200) {
      const msg = await res.text();
      throw new Error(`failed to fetch data for ${gcsPath}:\n${msg}`);
    }
    const data = await res.json();
    const cloudImage = {
      url: data.url,
      width: data.image_metadata?.width,
      height: data.image_metadata?.height,
    };
    if (this.pod.mode === 'dev') {
      this.cache.set(gcsPath, cloudImage);
    }
    const mergedData = Object.assign({}, imageData, cloudImage);
    return mergedData;
  }
}

class JsonFileCache {
  private pod: Pod;
  private path: string;
  private data: Record<string, any>;

  constructor(pod: Pod, path: string) {
    this.pod = pod;
    this.path = path;
    const realPath = this.pod.getFilePath(path);
    const dir = nodePath.dirname(realPath);
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir);
  }
    this.data = pod.readJson(path) || {};
  }

  get(key: string): any {
    return this.data[key];
  }

  set(key: string, value: any) {
    this.data[key] = value;
    this.save();
  }

  save() {
    this.pod.writeJson(this.path, this.data);
  }
}


