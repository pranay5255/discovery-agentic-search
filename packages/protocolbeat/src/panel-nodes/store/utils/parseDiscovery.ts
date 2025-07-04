import { z } from 'zod'

export type DiscoveryContract = z.infer<typeof DiscoveryContract>
export const DiscoveryContract = z
  .object({
    type: z.literal('Contract'),
    name: z.string(),
    address: z.string(),
    proxyType: z.optional(z.string()),
    values: z.optional(z.record(z.unknown())),
  })
  .passthrough()

export type DiscoveryEoa = z.infer<typeof DiscoveryEoa>
export const DiscoveryEoa = z
  .object({
    type: z.literal('EOA'),
    address: z.string(),
    roles: z.optional(z.array(z.string())),
  })
  .passthrough()

export type DiscoveryOutput = z.infer<typeof DiscoveryOutput>
export const DiscoveryOutput = z
  .object({
    name: z.string(),
    chain: z.string(),
    entries: z.array(z.union([DiscoveryContract, DiscoveryEoa])),
  })
  .passthrough()
