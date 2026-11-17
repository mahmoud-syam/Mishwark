import express, { Express } from 'express';

import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { errorMiddleware } from './v1/middlewares/errors.middleware';
import { PORT } from './secrets';
import rootRouterV1 from './v1/routes';
import path from 'path';
import fs from 'fs';

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


const app: Express = express();
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

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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


app.use("/api/v1", rootRouterV1);

// Admin web dashboard (built by `npm run dashboard:build`). Served from the
// API's own origin so the auth cookie is first-party and needs no CORS.
const DASHBOARD_DIST = path.join(process.cwd(), 'dashboard', 'dist');
if (fs.existsSync(DASHBOARD_DIST)) {
    app.use('/dashboard', express.static(DASHBOARD_DIST, { index: false, maxAge: '1h' }));
    app.get(/^\/dashboard(\/.*)?$/, (_req, res) => {
        res.sendFile(path.join(DASHBOARD_DIST, 'index.html'));
    });
}


app.use(errorMiddleware);

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
})