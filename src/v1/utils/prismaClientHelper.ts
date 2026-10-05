import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client";
import dotenv from "dotenv";

// The adapter captures DATABASE_URL at construction time, so the env has to be
// loaded here rather than relying on some other module having imported
// src/secrets first. Without this, import order decided whether the client got
// a real connection string or undefined (ECONNREFUSED at first query).
dotenv.config({ path: ".env" });

if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL is not set. Add it to .env (see .env.example) before starting the app."
    );
}

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL
});

const prismaClient = new PrismaClient({
    adapter
});

export default prismaClient;