import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
    throw new Error("DATABASE URL is not set in .env")
}

export const sql = postgres(DATABASE_URL)
