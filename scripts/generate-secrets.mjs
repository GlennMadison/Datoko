import { randomBytes } from "node:crypto";
console.log("Copy these into your private .env; do not commit them.");
console.log(`BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
