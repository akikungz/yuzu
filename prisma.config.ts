import { defineConfig } from "prisma/config";

export default defineConfig({
	schema: "./src/infrastructure/persistence/prisma/schema.prisma",
	migrations: {
		path: "./src/infrastructure/persistence/prisma/migrations",
	},
	datasource: {
		// biome-ignore lint/style/noNonNullAssertion: false
		url: process.env.DATABASE_URL!,
	},
});
