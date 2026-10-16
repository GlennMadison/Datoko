import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation is possible without live credentials. Migrations require a URL.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
