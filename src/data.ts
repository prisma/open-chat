// The app's emitted Prisma Next contract wrapped into the framework's
// `prisma-next` kind — the ONE value both ends of the database edge
// reference: the resource end (`pnPostgres({ name, contract, config })` in
// module.ts) and the dependency end (`pnPostgres(contract)` in service.ts).
import { pnContract } from "@prisma/composer-prisma-cloud/prisma-next";
import type { Contract } from "./prisma/contract.d.ts";
import contractJson from "./prisma/contract.json" with { type: "json" };

export const chatData = pnContract<Contract>(contractJson);
