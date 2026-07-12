import { sql } from "../src/db/client.ts"

const rows = await sql`SELECT 1 as ok`;
console.log(rows);