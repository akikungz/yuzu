import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@yuzu/infrastructure/config/env";

import { PrismaClient } from "./prisma/generated/client";

export const prisma = new PrismaClient({
	adapter: new PrismaPg({
		connectionString: env.DATABASE_URL,
		max: 10,
	}),
});

export type { PrismaClient } from "./prisma/generated/client";
export * from "./prisma/generated/enums";
