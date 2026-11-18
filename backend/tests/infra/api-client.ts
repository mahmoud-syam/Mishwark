import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import http from 'http';
import rootRouterV1 from '../../src/v1/routes';
import { errorMiddleware } from '../../src/v1/middlewares/errors.middleware';

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[]>;
  cookies: Record<string, string>;
}

export interface RequestOptions {
  body?: any;
  headers?: Record<string, string>;
  token?: string;
  cookies?: Record<string, string>;
}

export class ApiClient {
  private app: Express;
  private server: http.Server | null = null;
  private port: number = 0;
  private baseUrl: string = '';

  constructor() {
    this.app = express();
    // Lets a test act as another device by sending X-Forwarded-For.
    this.app.set('trust proxy', true);
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use('/api/v1', rootRouterV1);
    this.app.use(errorMiddleware);
  }

  public getApp(): Express {
    return this.app;
  }

  public async start(): Promise<string> {
    if (this.server) return this.baseUrl;
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.baseUrl = `http://127.0.0.1:${this.port}`;
          resolve(this.baseUrl);
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });
      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      if ((this.server as any).closeAllConnections) {
        (this.server as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }

  public async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: RequestOptions = {}
  ): Promise<TestResponse<T>> {
    await this.start();
    const fullPath = path.startsWith('/api/v1')
      ? path
      : `/api/v1${path.startsWith('/') ? path : '/' + path}`;
    const url = `${this.baseUrl}${fullPath}`;

    // FormData (file uploads) sets its own multipart Content-Type.
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const reqHeaders: Record<string, string> = {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    };

    const cookieParts: string[] = [];
    if (options.token) {
      cookieParts.push(`token=${options.token}`);
      reqHeaders['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.cookies) {
      for (const [k, v] of Object.entries(options.cookies)) {
        cookieParts.push(`${k}=${v}`);
      }
    }
    if (cookieParts.length > 0) {
      reqHeaders['Cookie'] = cookieParts.join('; ');
    }

    const init: RequestInit = {
      method,
      headers: reqHeaders,
    };

    if (options.body && method !== 'GET') {
      init.body = isForm || typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await fetch(url, init);
    const resHeaders: Record<string, string | string[]> = {};
    res.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    let body: any;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }

    const parsedCookies: Record<string, string> = {};
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const parts = setCookie.split(';');
      if (parts[0]) {
        const [k, v] = parts[0].split('=');
        if (k && v) parsedCookies[k.trim()] = v.trim();
      }
    }

    return {
      status: res.status,
      body,
      headers: resHeaders,
      cookies: parsedCookies,
    };
  }

  public get<T = any>(path: string, options: RequestOptions = {}): Promise<TestResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  public post<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<TestResponse<T>> {
    return this.request<T>('POST', path, { ...options, body });
  }

  public put<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<TestResponse<T>> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  public patch<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<TestResponse<T>> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  public delete<T = any>(path: string, options: RequestOptions = {}): Promise<TestResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }
}

export const createApiClient = (): ApiClient => new ApiClient();
