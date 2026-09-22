# Shim Boundary Pattern

A compatibility shim is a narrow file pair that isolates unstable or vendor-specific calls.

## Pattern

- public internal header defines extension-owned helper functions
- one implementation file contains direct upstream calls
- all other files call only the helper functions

## Benefits

- version churn is localized
- testing is easier
- architecture stays readable
- future major-version support is less invasive
