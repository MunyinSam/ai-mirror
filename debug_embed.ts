import { db, closeDb } from "./src/db/client.ts";

const litVec = `[${Array(768).fill(0).join(",")}]`;

console.log("--- unfiltered, no limit ---");
console.log(await db()`SELECT id, embedding <=> ${litVec}::vector AS distance FROM concepts WHERE embedding IS NOT NULL`);

console.log("--- with ORDER BY distance, no LIMIT ---");
console.log(await db()`SELECT id, embedding <=> ${litVec}::vector AS distance FROM concepts WHERE embedding IS NOT NULL ORDER BY distance`);

await closeDb();
