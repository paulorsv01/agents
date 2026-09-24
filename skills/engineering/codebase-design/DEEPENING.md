# Deepening

Use these dependency categories when reshaping a cluster into a deeper module.

| Dependency | Interface and verification strategy |
| --- | --- |
| In-process computation or state | Exercise behavior through the module's interface; keep internal boundaries only when useful. |
| Locally substitutable I/O | Use a local stand-in when it preserves the behavior under test. Keep test setup internal where practical. |
| Owned remote service | Separate domain behavior from transport when production and test adapters justify that seam. |
| Third-party service | Isolate the external contract and test owned behavior through a representative adapter or mock. |

Confirm that stand-ins represent the relevant semantics, including failures or transactions when those matter.
Expose dependencies to callers only when callers need to choose them.

## Verification during restructuring

Preserve observable behavior through the replacement interface.
Compare existing coverage with proposed tests before removing any tests within the authorized refactor.
Retain coverage for distinct failure modes. Report unrelated obsolete tests without deleting them.
A test that exercises internal behavior can remain useful when the public interface cannot isolate that behavior reliably.
