# Compatibility

Based on `vignettes/compatibility.Rmd` from `RConsortium/S7`.

## S3

- S7 objects are also S3 objects
- S7 can register methods for S3 generics
- S3 classes and S7 classes can interoperate
- Existing S3 behavior can often be preserved during migration

## S4

- S7 properties play a role similar to S4 slots
- S7 does not support multiple inheritance
- S4 unions and S7 unions should not be treated as dispatch-identical

## Migration mindset

Prefer gradual migration with explicit compatibility over large rewrites.
