// open-chat's Prisma Next data contract wrapped into the framework's
// `prisma-next` kind — the ONE value both ends reference: the resource end
// (`pnPostgres({ name, contract, config })` in module.ts) and the dependency
// end (`pnPostgres(openChatContract)` in service.ts). Emitted from
// contract.prisma by `prisma-next contract emit`.
//
// Typed as the framework's own AnyPnContract, not open-chat's generated
// Contract: the pkg.pr.new preview's @prisma/composer-prisma-cloud pins
// @prisma-next/*@0.15.0, while open-chat (and this contract.json) is on
// @prisma-next/postgres@^0.13.0 — the two versions' branded Contract types
// are nominally incompatible (FRICTION.md: "pnPostgres contract type version
// skew"), so the generated Contract type fails AnyPnContract's constraint.
// Nothing downstream reads the contract through its field types here — the
// framework only reads contractJson.storage.storageHash at runtime — so
// widening costs nothing for this port; open-chat's own src/prisma/db.ts
// keeps building its fully field-typed client straight from contract.json.
import type { AnyPnContract } from "@prisma/composer-prisma-cloud/prisma-next";
import { pnContract } from "@prisma/composer-prisma-cloud/prisma-next";
import contractJson from "../prisma/contract.json" with { type: "json" };

export const openChatContract = pnContract<AnyPnContract>(contractJson);
