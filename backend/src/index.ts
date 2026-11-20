import express, { Express } from 'express';
import { stripSecretsMiddleware } from "./v1/middlewares/strip-secrets.middleware";

import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { errorMiddleware } from './v1/middlewares/errors.middleware';
import { PORT } from './secrets';
import rootRouterV1 from './v1/routes';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import Notify from './v1/services/notify.service';
import PushService from './v1/services/push.service';
import ReviewService from './v1/services/review.service';

const OPENAPI_SPEC_PATH = path.join(process.cwd(), 'api-docs', 'mishwarak.openapi.json');

function loadOpenApiSpec(): Record<string, unknown> {
    try {
        return JSON.parse(fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8'));
    } catch (err) {
        console.warn(
            `[api-docs] Could not load ${OPENAPI_SPEC_PATH}. Run "npm run api-docs:build" to regenerate it. (${(err as Error).message})`
        );
        return {
            openapi: '3.0.0',
            info: { title: 'Mishwarak API', version: '1.0.0' },
            description:
                'The OpenAPI specification could not be loaded. Run `npm run api-docs:build` to regenerate `api-docs/mishwarak.openapi.json`.',
            paths: {},
        };
    }
}


// Sessions are signed with JWT_SECRET: without a real one, refuse to start
// rather than fail at the first sign-in (or sign with a weak key).
if (!process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32)) {
    console.error('[config] JWT_SECRET is missing' + (process.env.NODE_ENV === 'production' ? ' or shorter than 32 characters' : '') + '. Set it in .env.');
    process.exit(1);
}

const app: Express = express();
const isProduction = process.env.NODE_ENV === 'production';

// Client IP behind a proxy. Cloudflare Tunnel (cloudflared on the same machine)
// forwards from localhost, so "loopback" is right there. Behind another proxy
// set TRUST_PROXY (e.g. "1" for one hop, or the proxy's address). Without it,
// every visitor would share the proxy's address and the limits below would
// block everyone at once.
const trustProxy = process.env.TRUST_PROXY ?? 'loopback';
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

// Security headers. Uploaded photos stay loadable by the apps (cross-origin).
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Request limits per IP on sign-in. Wrong passwords and codes are limited per
// device and account in SignInGuard; these stop floods and SMS abuse.
// AUTH_RATE_LIMIT / OTP_REQUEST_RATE_LIMIT: requests per IP per 15 minutes.
const tooMany = { message: 'Too many requests. Try again in a few minutes', errorCode: 4290, errors: null };
const perIp = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: tooMany });
app.use('/api/v1/auth', perIp(Number(process.env.AUTH_RATE_LIMIT ?? 100)));
app.use('/api/v1/auth/otp/request', perIp(Number(process.env.OTP_REQUEST_RATE_LIMIT ?? 10)));
// Place search calls OpenStreetMap services on the visitor's behalf.
app.use('/api/v1/places', perIp(Number(process.env.PLACES_RATE_LIMIT ?? 300)));
// Public price/distance estimates call the routing service (a paid key when set).
app.use(['/api/v1/bookings/estimate-price', '/api/v1/bookings/estimate-distance'], perIp(Number(process.env.ESTIMATE_RATE_LIMIT ?? 300)));

app.use(cookieParser());

app.use(express.json());
const corsOptions = {
    origin: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:53666",
        "http://127.0.0.1:53666",
        "http://192.168.4.103:5000",
        // Extra origins (e.g. the deployed web dashboard), comma-separated.
        ...(process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
};

app.use(cors(corsOptions));


app.use(express.urlencoded({ extended: true }));

// Public files: car photos and profile pictures only. Anything else under
// uploads/ (older uploads, stray files) is not served.
const UPLOADS = path.join(process.cwd(), 'uploads');
app.use('/uploads/vehicles', express.static(path.join(UPLOADS, 'vehicles'), { index: false }));
app.use('/uploads/employees', (req, res, next) => (/^\/pic-[\w.-]+$/.test(req.path) ? next() : res.status(404).end()), express.static(path.join(UPLOADS, 'employees'), { index: false }));

const openApiSpec = loadOpenApiSpec();

app.get('/api-docs.json', (_req, res) => {
    res.json(openApiSpec);
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'Mishwarak API Docs',
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        docExpansion: 'none',
        defaultModelsExpandDepth: 1,
        tryItOutEnabled: true,
    },
}));


// Never send password hashes, OTP codes or 2FA secrets, whatever a handler returns.
app.use("/api/v1", stripSecretsMiddleware);
app.use("/api/v1", rootRouterV1);

// Admin web dashboard (frontend/, built by `npm run dashboard:build`). Served
// from the API's own origin so the auth cookie is first-party and needs no CORS.
// DASHBOARD_DIST points at the build; the default fits this repo's layout
// (backend/ and frontend/ side by side). A deployment can set its own path.
const DASHBOARD_DIST = path.resolve(process.cwd(), process.env.DASHBOARD_DIST || '../frontend/dist');
if (fs.existsSync(DASHBOARD_DIST)) {
    // The dashboard only loads its own files (plus data: images such as the 2FA QR, and map tiles).
    app.use('/dashboard', helmet.contentSecurityPolicy({
        directives: {
            // OpenStreetMap tiles for the booking map.
            'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
            'upgrade-insecure-requests': isProduction ? [] : null,
        },
    }));
    // OpenStreetMap refuses map tiles without a Referer (tile usage policy), and
    // helmet's default no-referrer hides it. The dashboard sends only its
    // origin to other sites, never the path.
    app.use('/dashboard', helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
    app.use('/dashboard', express.static(DASHBOARD_DIST, { index: false, maxAge: '1h' }));
    app.get(/^\/dashboard(\/.*)?$/, (_req, res) => {
        res.sendFile(path.join(DASHBOARD_DIST, 'index.html'));
    });
} else {
    console.warn(`[dashboard] no build at ${DASHBOARD_DIST}; run \`npm run dashboard:build\` to serve /dashboard`);
}


app.use(errorMiddleware);

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    // Trip reminders (and any push still waiting) go out every minute.
    if (process.env.NOTIFICATIONS_WORKER !== 'off') {
        Notify.startWorker();
        // Reviews that waited 48 hours for the other side are shown, and ratings updated.
        const release = () => ReviewService.releaseDue().catch((e) => console.error('[reviews] release:', e.message));
        setInterval(release, 10 * 60_000).unref();
        release();
    }
    console.log(`[push] ${PushService.isConfigured() ? 'Firebase push is on' : 'push is off (no FCM_SERVICE_ACCOUNT_*): notifications go to the in-app inbox only'}`);
})