## Discovery Engine Control Flow

This document explains the dependency control flow of each component in the discovery engine and how it works.

### Dependency Flow

1.  **`DiscoveryRunner`** starts the process, invoking `DiscoveryEngine`.
2.  **`DiscoveryEngine`** coordinates analysis, relying on `AddressAnalyzer` for each contract.
3.  **`AddressAnalyzer`** uses:
    - `ProxyDetector` to identify proxy contracts.
    - `SourceCodeService` to fetch source code.
    - `HandlerExecutor` to run handlers.
    - `TemplateService` to apply contract templates.
4.  **`HandlerExecutor`** retrieves and executes handlers based on the project configuration.
5.  **Handlers**, such as `StorageHandler`, use the `Provider` to interact with the blockchain, reading storage slots or calling functions.
6.  **`saveDiscoveryResult`** finalizes the process, saving outputs to files.

---

### Q1. How does `DiscoveryRunner` code work?

The `DiscoveryRunner` class (in `packages/backend/src/modules/update-monitor/DiscoveryRunner.ts`) is responsible for running the discovery process for a given project.

```typescript
export class DiscoveryRunner {
  constructor(
    private readonly allProviders: AllProviders,
    private readonly discoveryEngine: DiscoveryEngine,
    private readonly templateService: TemplateService,
    readonly chain: string,
  ) {}

  private async discover(
    config: ConfigRegistry,
    blockNumber: number,
  ): Promise<DiscoveryRunResult> {
    const provider = this.allProviders.get(config.chain, blockNumber)
    const result = await this.discoveryEngine.discover(
      provider,
      config.structure,
    )
    // ...
  }

  async discoverWithRetry(
    //...
  ): Promise<DiscoveryRunResult> {
    // ...
  }
}
```

#### Code Explanation

1.  **`DiscoveryRunner` Class**: This class encapsulates the logic for running a discovery on a specific chain.
    *   **`constructor`**: It is initialized with instances of `AllProviders` (to get blockchain data), `DiscoveryEngine` (the core of the discovery process), and `TemplateService` (for contract templates). The `private readonly` syntax in TypeScript makes the parameters properties of the class that can't be modified after initialization.
    *   **`discover(config, blockNumber)`**: This is the main private method that performs the discovery. It retrieves a blockchain `provider` and calls `this.discoveryEngine.discover(...)`, which is the entry point to the core discovery logic.
    *   **`discoverWithRetry(...)`**: This public method wraps `discover` with a retry mechanism, making the process more resilient to transient network or provider errors. `async/await` syntax is used to handle asynchronous operations.

---

### Q2. Explain the core discovery algorithm.

The core discovery algorithm is implemented in the `DiscoveryEngine` class (`packages/discovery/src/discovery/engine/DiscoveryEngine.ts`). It functions like a graph traversal algorithm (specifically, a breadth-first search) to explore all reachable contracts from a set of initial addresses.

```typescript
export class DiscoveryEngine {
  async discover(
    provider: IProvider,
    config: StructureConfig,
  ): Promise<Analysis[]> {
    const resolved: Record<string, Analysis> = {}
    let toAnalyze: AddressesWithTemplates = {}
    
    config.initialAddresses.forEach((address) => {
      toAnalyze[address.toString()] = new Set()
    })

    while (Object.keys(toAnalyze).length > 0) {
      // ...
      await Promise.all(
        leftToAnalyze.map(async ({ address, templates }) => {
          const analysis = await this.addressAnalyzer.analyze(
            provider,
            address,
            //...
          )
          resolved[address.toString()] = analysis
          if (analysis.type === 'Contract') {
            // Add relatives to the toAnalyze queue
          }
        }),
      )
    }
    return Object.values(resolved)
  }
}
```

#### Algorithm Explanation

*   **Initialization**: The engine starts with a `toAnalyze` queue, seeded with the project's `initialAddresses`. A `resolved` object is used to cache the results of contracts that have already been analyzed.
*   **The Main Loop (`while`)**: The discovery continues as long as there are addresses in the `toAnalyze` queue.
*   **Batch Analysis (`Promise.all`)**: In each iteration, the engine analyzes a batch of contracts from the queue in parallel for efficiency.
*   **`addressAnalyzer.analyze`**: For each address, it calls the `AddressAnalyzer`, which performs the detailed inspection of the contract.
*   **Discovering Relatives**: If the analysis of a contract reveals new, related addresses (e.g., an implementation contract of a proxy), these new addresses are added to the `toAnalyze` queue for the next iteration.
*   **Termination**: The loop ends when the `toAnalyze` queue is empty, meaning all reachable contracts have been explored. The function then returns all the collected analysis results.

---

### Q3. How do `ProxyDetector` and `HandlerExecutor` work?

The `AddressAnalyzer` (`packages/discovery/src/discovery/analysis/AddressAnalyzer.ts`) uses several helper services, including `ProxyDetector` and `HandlerExecutor`.

```typescript
export class AddressAnalyzer {
  constructor(
    private readonly proxyDetector: ProxyDetector,
    private readonly sourceCodeService: SourceCodeService,
    private readonly handlerExecutor: HandlerExecutor,
    private readonly templateService: TemplateService,
  ) {}

  async analyze(
    // ...
  ): Promise<Analysis> {
    const proxy = await this.proxyDetector.detectProxy(/*...*/)
    // ...
    const { values } = await this.handlerExecutor.execute(/*...*/)
    // ...
  }
}
```

#### `ProxyDetector`

1.  **Purpose**: Its function is to identify if a contract is a proxy and find the address of the underlying implementation contract. This is crucial because a contract's logic often resides in a separate implementation contract that can be upgraded.
2.  **Execution**: The `AddressAnalyzer` calls `this.proxyDetector.detectProxy(...)`. The detector then checks for known proxy patterns (like EIP-1967) by reading specific storage slots from the contract to find the implementation address.

#### `HandlerExecutor`

1.  **Purpose**: This component executes a set of "handlers" on a contract. Handlers are small, reusable pieces of logic defined in the discovery configuration that extract specific information, such as the value of a state variable or the owner of the contract.
2.  **Execution**: The `AddressAnalyzer` calls `this.handlerExecutor.execute(...)`, providing it with the contract's ABI and the handler configurations. The executor then runs each handler, which in turn interacts with the blockchain to read data. It aggregates the results from all handlers.

---

### Q4. How do templates get created and how are they matched with incoming contracts?

Templates allow for the reuse of discovery configurations across similar contracts. The `TemplateService` (`packages/discovery/src/discovery/analysis/TemplateService.ts`) manages them.

#### Template Creation

Templates are defined manually by developers inside a special `_templates` directory. Each template has its own subdirectory.

*   **`template.jsonc`**: This file is the core of the template, containing the reusable configuration (e.g., fields, handlers).
*   **`shapes.json`**: This optional file contains a list of source code hashes. It's the primary mechanism for matching contracts to templates.
*   **`criteria.json`**: This optional file allows for more specific matching rules, like a list of addresses the template is valid for.

#### Template Matching

The `TemplateService.findMatchingTemplates` method is used to find the right template for a contract.

1.  **Source Code Hash**: It calculates a hash of the contract's verified source code.
2.  **Hash Index Lookup**: It maintains an in-memory `hashIndex` that maps source code hashes to template IDs. It uses this index to find candidate templates.
3.  **Criteria and Scoring**: It then applies any additional criteria from `criteria.json` and uses a scoring system to find the best match if multiple templates have the same source code hash.
4.  **Return Best Match**: The service returns the template(s) with the highest score. The `AddressAnalyzer` then applies the configuration from the matched template.

---

### Q5. How does `StorageHandler` work?

The `StorageHandler` (`packages/discovery/src/discovery/handlers/user/StorageHandler.ts`) is a specific handler for reading raw data directly from a contract's storage.

```typescript
export class StorageHandler implements Handler {
  async execute(
    provider: IProvider,
    address: EthereumAddress,
    // ...
  ): Promise<HandlerResult> {
    // ...
    const slot = computeSlot(resolved)
    storage = await provider.getStorage(address, slot)
    // ...
    return {
      field: this.field,
      value: bytes32ToContractValue(storage, resolved.returnType),
    }
  }
}
```

#### Code Explanation

*   **Configuration**: Its definition in `discovery.json` specifies a `slot` to read. This can be a single value or an array of values for accessing nested mappings. It can also specify a `returnType` to format the result correctly.
*   **`computeSlot`**: This helper function calculates the final storage slot to be read. If the `slot` from the configuration is an array (for a mapping), it iteratively hashes the elements to find the correct storage location, mimicking the EVM's logic.
*   **`provider.getStorage`**: This is the core of the handler. It makes an `eth_getStorageAt` JSON-RPC call to the blockchain to retrieve the 32-byte value from the specified `slot` of the contract.
*   **Formatting**: The raw bytes returned from the provider are then formatted by `bytes32ToContractValue` into a more useful type, like an `address` or a `number`, based on the `returnType` in the configuration.

