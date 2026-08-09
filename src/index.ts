import express, { Express } from 'express';

import cors from 'cors';
import cookieParser from 'cookie-parser';
import { errorMiddleware } from './v1/middlewares/errors.middleware';
import { PORT } from './secrets';
import rootRouterV1 from './v1/routes';
import path from 'path';


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

    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
};

app.use(cors(corsOptions));


app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));


app.use("/api/v1", rootRouterV1);


app.use(errorMiddleware);

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
})