# Out of scope for v1 research

This pass does not commit to:

- a full Linux/POSIX kernel contract, including device nodes, hard links,
  arbitrary ownership bits, mmap coherence, or mandatory distributed locks;
- defining new product inheritance semantics beyond preserving current core
  `Mount` behavior and supporting explicit configuration;
- cross-security-partition FS sharing or public anonymous FS instances;
- automatic reassignment of core associations during FS transfer;
- silently moving an existing FS between routes/backends;
- allowing ordinary callers to register arbitrary endpoints or adapter code;
- storing plaintext backend credentials or exposing them to sandboxes;
- implementing every S3 vendor or every Git hosting provider in the first release;
- treating ArtifactFS refresh/commit/push as required common FS operations;
- promising standard/custom remote ArtifactFS routes before an authenticated,
  tenant-safe service protocol exists;
- universal kernel mounting when a gateway data-plane/proxy path is safer;
- changing existing mount IDs, slugs, contents, or retention behavior without a
  migration and compatibility gate;
- moving project/agent/session association logic into the FS gateway;
- deleting FS instances through an inferred product-domain cascade;
- committing to endpoint names, HTTP paths, or persistence schemas shown in these
  research notes.

The common FS contract itself is in scope. A backend that cannot meet it
must be wrapped until it can, or left disabled; callers are not expected to learn
backend-specific file semantics.
